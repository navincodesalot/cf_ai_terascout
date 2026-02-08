# Terascout

AI-powered event intelligence on Cloudflare. Natural language in, structured email alerts out. Polls sources every 10 minutes, uses an LLM to filter noise, deduplicates, and notifies you when something real happens.

**Check it out at:** [terascout.vael.ai](https://terascout.vael.ai)

## Cloudflare Technologies Used

| Technology                                   | What it does here                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Workers AI** (`Llama-3.1-8b-instruct-fp8`) | Query extraction, change analysis, semantic deduplication — 3 LLM calls per decision cycle |
| **Durable Objects** (SQLite)                 | Per-scout isolated state — config, snapshots, events, email counters                       |
| **Workflows**                                | Durable polling loop with per-step retries, timeouts, and exponential backoff              |
| **Workers**                                  | API + SPA (React) hosting in a single deploy                                               |
| **Assets**                                   | SPA serving with `not_found_handling: "single-page-application"`                           |

## Setup

```bash
git clone https://github.com/navincodesalot/cf_ai_terascout
pnpm install
cp .env.example .env   # add your RESEND_API_KEY
pnpm dev               # http://localhost:8787
```

For production:

```bash
pnpx wrangler secret put RESEND_API_KEY
pnpm deploy
```

Or push to `main` — GitHub Actions deploys via `wrangler-action`.

### Prerequisites

Node 22+, pnpm 10+, Cloudflare account (free tier works), [Resend](https://resend.com) API key.

## How It Works

### Workers AI — 3 LLM calls per cycle

1. **Query extraction** (`ai.ts → extractSearchQueryWithTime`) — _"keep me in the loop on today's Super Bowl pre-game events"_ → `{ query: "Super Bowl pre-game", time_range: "1d" }`. Strips filler, picks a Google News time filter.

2. **Change analysis** (`ai.ts → analyzeChange`) — Fetches the Google News page, SHA-256 hashes it, compares to last snapshot. If changed, the LLM diffs old vs new text and extracts: TL;DR, summary, highlights, article titles/URLs, and a breaking news flag.

3. **Semantic dedup** (`ai.ts → isDuplicateEvent`) — Compares the new event summary against the last 5 events. Same story rephrased across polls gets silently dropped.

### Durable Objects — per-scout state

Each scout is a `ScoutDO` instance with 4 SQLite tables:

- `config` — query, email, `expiresAt` (hard stop timestamp)
- `sources` — URL, `lastHash`, `lastText` for content diffing
- `events` — idempotent by `eventId` = SHA-256(`sourceUrl|oldHash|newHash`)
- `email_counter` — daily send count, auto-resets

DOs instead of D1 because each scout is an independent actor with its own lifecycle — no shared-table contention, co-located storage.

### Workflows — durable polling loop

`ScoutWorkflow` runs up to 200 cycles per instance:

```
Load config → check expiration → check email rate limit
  → fetch source (retries: 2, timeout: 30s)
  → hash diff → LLM analysis → LLM dedup
  → record event (idempotent) → send email (retries: 3, exp backoff)
  → sleep 10 min → repeat
```

Per-instance lifecycle (not a shared cron). Failed fetches skip that source, workflow continues. Hard stop: workflow checks `expiresAt` each cycle and terminates when expired.

### Smart expiration

The frontend uses [chrono-node](https://github.com/wanasit/chrono) to parse time references from the query — _"today's events"_ auto-selects end-of-day. Manual datetime picker as fallback. Default: 3 days.

### Email alerts

Rich HTML via Resend: breaking news banner, TL;DR, detailed summary, key highlights, and individual article links with snippets. Rate-limited to 10/day per scout (configurable).

## Configuration

`worker/config.ts` — change and redeploy:

```typescript
export const SCOUT_CONFIG = {
  maxEmailsPerScoutPerDay: 10,
  defaultLifetimeHours: 72,
  maxLifetimeHours: 168,
  pollInterval: "10 minutes",
  maxCycles: 200,
  maxAiTextLength: 2500,
  dedupeLookback: 5,
};
```

## Project Structure

```
worker/
├── index.ts              # API routes (create/read/delete scouts)
├── scout-do.ts           # Durable Object — per-scout SQLite state
├── scout-workflow.ts     # Workflow — polling loop with retry/backoff
├── config.ts             # Tunable defaults (email limits, intervals)
├── types.ts              # Shared TypeScript interfaces
└── lib/
    ├── ai.ts             # 3 LLM calls: query extraction, analysis, dedup
    ├── email.ts          # Resend email — TLDR + highlights + articles
    └── fetcher.ts        # Fetch + text extraction + SHA-256 hashing

frontend/
├── App.tsx               # Scout creation + list management
├── components/
│   ├── HeroSearch.tsx    # Search input
│   ├── ScoutForm.tsx     # Creation dialog with chrono-node NLP time parsing
│   └── ScoutList.tsx     # Active scouts — events, articles, countdowns
└── lib/
    ├── api.ts            # Typed fetch wrappers
    └── utils.ts          # Tailwind cn() helper
```

## Stack

| Layer    | Technology                                              |
| -------- | ------------------------------------------------------- |
| Frontend | React 19, Vite, Tailwind CSS 4, shadcn/ui, chrono-node  |
| Backend  | Cloudflare Workers, Durable Objects (SQLite), Workflows |
| AI       | Cloudflare Workers AI — Llama 3.1 8B                    |
| Email    | Resend                                                  |
| CI/CD    | GitHub Actions → wrangler-action                        |

## License

MIT

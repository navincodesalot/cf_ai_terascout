# Terascout

AI-powered web monitoring on Cloudflare. Describe what you want to track in plain English—Terascout discovers sources, polls for changes, and emails you when something relevant happens.

Inspired by [Yutori Scouts](https://yutori.com/scouts).

## Stack

- **Frontend**: React + Vite + Tailwind + shadcn/ui
- **Backend**: Cloudflare Workers, Durable Objects, Workflows
- **AI**: Cloudflare Workers AI (Llama) for change analysis
- **Source discovery**: Google News search URLs with LLM-chosen time range (1d/7d/30d or none)
- **Email**: Resend

## Setup

```bash
pnpm install
```

### Environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable         | Required | Description                                                                     |
| ---------------- | -------- | ------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | Yes      | Resend API key for email notifications. Get at [resend.com](https://resend.com) |

For production:

```bash
wrangler secret put RESEND_API_KEY
```

## Development

```bash
pnpm dev
```

Runs the Worker locally with `wrangler dev`. The frontend is served from the Worker.

## Build & Deploy

```bash
pnpm build
pnpm deploy
```

Or push to `main` for GitHub Actions deploy.

## How it works

### 1. Scout creation (Worker API)

User submits `{ query, email }` to `POST /api/scouts`.

| Step | What happens                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | **LLM: query + time range** — Extracts search terms and decides time sensitivity                                    |
|      | • "lmk about spacex IPO" → `{ query: "spacex IPO", time_range: "7d" }`                                              |
|      | • "history of tesla" → `{ query: "tesla history", time_range: null }`                                               |
| 2    | **Build Google News URL** — `https://news.google.com/search?q=spacex+IPO+when:7d` (or no `when` for general topics) |
| 3    | **Save config** — Store `{ scoutId, query, email, sources }` in Durable Object                                      |
| 4    | **Start workflow** — Create `ScoutWorkflow` instance with `scoutId`                                                 |

### 2. Polling loop (Workflow, every 10 min)

| Step | What happens                                                                             |
| ---- | ---------------------------------------------------------------------------------------- |
| 1    | **Load config** — Fetch config + sources from DO                                         |
| 2    | **For each source**                                                                      |
|      | • **Fetch** — GET Google News URL, extract text, hash it                                 |
|      | • **Diff** — Compare hash to last snapshot (from DO)                                     |
|      | • **Save snapshot** — Update DO with new hash/text                                       |
|      | • **If content changed**                                                                 |
|      | - **LLM: event analysis** — "Is this change meaningful?" (new articles, headlines, etc.) |
|      | - **If meaningful**                                                                      |
|      | - **LLM: deduplication** — Compare summary to last 5 events. Same news? Skip.            |
|      | - **If not duplicate**                                                                   |
|      | - **Record event** — Store in DO (idempotent by eventId)                                 |
|      | - **Send email** — Resend, one per distinct event                                        |
| 3    | **Sleep** — 10 minutes, then repeat                                                      |

### 3. When emails are sent

An email is sent only when **all** of these are true:

| #   | Condition                                                                   |
| --- | --------------------------------------------------------------------------- |
| 1   | Content hash changed (page is different from last poll)                     |
| 2   | LLM says it's a meaningful event (not ads, timestamps, layout noise)        |
| 3   | LLM says it's not a duplicate of recent events (same story, different poll) |
| 4   | Event hasn't been recorded before (idempotency)                             |

### 4. Summary

- **One source per scout**: Google News search URL
- **Time filter**: LLM picks `when:1d` / `when:7d` / `when:30d` for time-sensitive queries, or none for general
- **Deduplication**: LLM compares new events to last 5 to avoid repeat emails for the same news
- **Resilience**: Sources that fail to fetch are skipped; workflow continues

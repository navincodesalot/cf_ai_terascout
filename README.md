# Terascout

AI-powered web monitoring on Cloudflare. Describe what you want to track in plain English—Terascout discovers sources, polls for changes, and emails you when something relevant happens.

Inspired by [Yutori Scouts](https://yutori.com/scouts).

## Stack

- **Frontend**: React + Vite + Tailwind + shadcn/ui
- **Backend**: Cloudflare Workers, Durable Objects, Workflows
- **AI**: Cloudflare Workers AI (Llama) for change analysis
- **Source discovery**: [Tavily](https://tavily.com) web search or Google News fallback
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

| Variable         | Required | Description                                                                                                                   |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | Yes      | Resend API key for email notifications. Get at [resend.com](https://resend.com)                                               |
| `TAVILY_API_KEY` | No       | Tavily API key for real web search. Get at [app.tavily.com](https://app.tavily.com). Without it, uses Google News search URLs |

For production, set secrets via Wrangler:

```bash
wrangler secret put RESEND_API_KEY
wrangler secret put TAVILY_API_KEY   # optional
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

1. **Create a scout** — Enter a query (e.g. "SpaceX IPO updates") and your email
2. **Source discovery** — Tavily (if configured) or Google News finds real URLs to monitor. URLs are validated before adding
3. **Polling** — A Workflow polls each source every 10 minutes, diffs content
4. **Event detection** — When content changes, the LLM decides if it's a meaningful event
5. **Notification** — You get one email per distinct event

Sources that fail to fetch are skipped; the workflow continues with the rest.

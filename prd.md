# Scouts on Cloudflare

This project is called "Terascout", it is a minimized replication of Yutori Scouts (an AI startups product). https://yutori.com/scouts

A single-repo, lowest-friction architecture to ship a **React SPA + backend infra** on Cloudflare Workers, using **Durable Objects** for per-scout state and **Cloudflare Workflows** for long‑running background execution. This is an Cloudflare internship application project, and I just need to show them I can use Cloudflare infra uniquely and smartly.

This design optimizes for:

- One deployable Workers project (no Pages)
- Minimal infra surface area
- Clear mental model (1 scout = 1 DO + 1 workflow loop)
- Easy iteration with pnpm + GitHub Actions

---

## High-level architecture

**One Workers project** serves everything:

- Static React frontend
- API routes
- Durable Objects
- Workflows

```
Browser
  ↓
Cloudflare Worker
  ├── Static assets (React SPA)
  ├── /api/scouts (CRUD)
  ├── /api/history
  ├── Durable Objects (1 per scout)
  └── Workflows (long-running scout loops)
```

No auth for v1. Everything is keyed by a generated `scoutId`. Rate limiting and auth can be layered later.

---

## Tech stack

### Frontend

- **React SPA** (Vite)
- **Tailwind CSS** for layout
- **shadcn/ui** for primitives (Dialog, Select, Input, Button)
- Built once and served directly from the Worker as static assets

### Backend

- **Cloudflare Workers** for API + asset serving
- **Durable Objects**
  - One DO per scout
  - Stores config + lightweight state

- **Cloudflare Workflows**
  - Handles long-running execution
  - Durable sleep, retries, continuation
  - Per-source error handling (skips failed sources, continues with others)

- **Source discovery**
  - **Tavily** (optional): Real web search API for current URLs. Set `TAVILY_API_KEY` via `wrangler secret put`. Without it, falls back to Google News search URLs.
  - **Source validation**: HEAD/GET checks before adding; filters out unreachable URLs.
  - Workers AI Llama used only for query extraction and change analysis—not for URL generation (LLMs hallucinate URLs).

### Tooling

- **pnpm** workspace
- **GitHub Actions** CI/CD
- **wrangler** for deploys

---

## Repo structure (single repo, pnpm)

```
terascout/
├── package.json
├── pnpm-lock.yaml
├── wrangler.jsonc
├── .github/workflows/deploy.yml
├── frontend/              # React + Vite + Tailwind + shadcn
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx        # Search bar, dialog, history
│   │   └── components/
│   └── ...
└── worker/                # Workers / DO / Workflows
    ├── index.ts           # Worker entry: APIs + static assets
    ├── scout-do.ts        # Durable Object per scout
    ├── scout-workflow.ts  # Polling loop
    └── lib/
        ├── ai.ts          # Source discovery + change analysis (LLM)
        ├── tavily.ts      # Tavily web search (real URLs)
        ├── source-validation.ts  # URL reachability checks
        ├── fetcher.ts     # Fetch + HTML text extraction
        └── email.ts       # Resend email sender
```

### pnpm workspace config (root `package.json`)

```json
{
  "private": true,
  "packageManager": "pnpm@9",
  "workspaces": ["frontend", "src"]
}
```

---

## Bootstrap

### 1. Create project

Use the official Cloudflare scaffolding (React + Vite + Worker):

```bash
pnpm create cloudflare@latest scouts-cloudflare
cd scouts-cloudflare
pnpm install
```

Choose a **React + Vite** Workers template if prompted.

This gives you:

- Worker entry
- Vite-powered React app
- Static asset serving wired automatically

---

### 2. Add Tailwind + shadcn

Inside `frontend/`:

1. Install Tailwind (Vite + React flow)
2. Initialize shadcn/ui

``  `bash
cd frontend
npx shadcn@latest init

````

Use shadcn components for:

* Dialog (scout config)
* Input (search bar)
* Select (schedule type)
* Date / time pickers

---

## Durable Objects model

Each **Scout** is a single Durable Object instance.

### Scout config shape

```ts
export interface ScoutConfig {
  id: string;
  query: string;
  scheduleType: "interval" | "daily" | "on-event";
  intervalMinutes?: number;
  dailyTime?: string;
  endAt?: string;          // ISO timestamp
  email: string;
  createdAt: string;
}
````

### Durable Object implementation

```ts
export class ScoutDO {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/config") {
      const cfg = await this.state.storage.get<ScoutConfig>("config");
      return Response.json(cfg);
    }

    if (req.method === "POST" && url.pathname === "/config") {
      const cfg = (await req.json()) as ScoutConfig;
      await this.state.storage.put("config", cfg);
      return Response.json(cfg);
    }

    return new Response("Not found", { status: 404 });
  }
}
```

### Bind the DO

```toml
[[durable_objects.bindings]]
name = "SCOUT_DO"
class_name = "ScoutDO"
```

This follows Cloudflare guidance: **one Durable Object per logical unit of coordination/state**.

---

## Workflows: long-running scouts

Each scout runs inside a **Workflow loop**.

Why Workflows:

- Durable sleep (minutes → days)
- Automatic retries
- No cron glue code
- Built on DO alarms internally

### Workflow logic

```ts
import { WorkflowEntrypoint, Step } from "@cloudflare/workflows";

interface RunInput {
  scoutId: string;
}

export class ScoutWorkflow extends WorkflowEntrypoint<Env, RunInput> {
  async run(event: { input: RunInput }) {
    const { scoutId } = event.input;

    // 1. Load config from DO
    const cfg = await Step.do("load-config", async (ctx) => {
      const id = ctx.env.SCOUT_DO.idFromName(scoutId);
      const stub = ctx.env.SCOUT_DO.get(id);
      const res = await stub.fetch("https://internal/config");
      return await res.json();
    });

    // 2. Run check
    const shouldNotify = await Step.do("run-check", async () => {
      // TODO: search engine / API / Workers AI
      return true;
    });

    // 3. Notify
    if (shouldNotify) {
      await Step.do("send-email", async () => {
        // Email provider or Cloudflare Email Routing
      });
    }

    // 4. Sleep until next run
    await Step.sleep("wait-until-next", this.nextDelayMs(cfg));

    // 5. Continue loop
    return this.run({ input: { scoutId } });
  }

  private nextDelayMs(cfg: any): number {
    return (cfg.intervalMinutes ?? 60) * 60 * 1000;
  }
}
```

### Register workflow

```toml
[[workflows]]
name = "scout-workflow"
class_name = "ScoutWorkflow"
```

---

## Worker entry: APIs + static assets

Single Worker handles everything.

```ts
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);

    // Serve frontend
    if (url.pathname.startsWith("/assets") || url.pathname === "/") {
      return env.ASSETS.fetch(req);
    }

    // Create scout
    if (url.pathname === "/api/scouts" && req.method === "POST") {
      const body = await req.json();
      const id = crypto.randomUUID();

      const config = {
        ...body,
        id,
        createdAt: new Date().toISOString(),
      };

      const doId = env.SCOUT_DO.idFromName(id);
      const stub = env.SCOUT_DO.get(doId);

      await stub.fetch("https://internal/config", {
        method: "POST",
        body: JSON.stringify(config),
      });

      await env.SCOUT_WORKFLOWS.start("scout-workflow", { scoutId: id });

      return Response.json({ id });
    }

    // History (v1 stub)
    if (url.pathname === "/api/history") {
      return Response.json([]);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

You can later:

- Add D1 for history
- Add KV for global indexes
- Add auth/rate limits

---

## React UI structure

**`App.tsx` layout:**

- Large Google-style input
- Submit → opens shadcn `Dialog`
- Dialog fields:
  - Schedule type (interval / daily / event)
  - Time or interval
  - End date (optional)
  - Email

- Submit → POST `/api/scouts`
- Below: history list from `/api/history`

shadcn handles interaction polish; Tailwind handles layout speed.

---

## CI/CD (GitHub Actions)

Deploy on every push to `main`.

`.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - name: Install deps
        run: pnpm install
      - name: Build frontend
        run: pnpm --filter frontend build
      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

---

## Why this architecture works

- **One repo, one deploy**
- **No cron hacks** (Workflows handle it)
- **State is local and intuitive** (1 scout = 1 DO)
- **Frontend and backend evolve together**
- **Easy to demo, easy to extend**

This is the cleanest Cloudflare-native way to ship a UX + infra-heavy product fast.

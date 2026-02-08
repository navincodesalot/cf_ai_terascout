import { discoverSources } from "./lib/ai";
import type {
  CreateScoutRequest,
  CreateScoutResponse,
  ScoutConfig,
  ScoutEvent,
  ScoutStatusResponse,
} from "./types";

// Re-export DO and Workflow classes so wrangler can find them
export { ScoutDO } from "./scout-do";
export { ScoutWorkflow } from "./scout-workflow";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── CORS headers for local dev ────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ── POST /api/scouts — create a new scout ───────────────────
      if (path === "/api/scouts" && request.method === "POST") {
        return withCors(await handleCreateScout(request, env));
      }

      // ── GET /api/scouts/:id — get scout status + events ─────────
      const getMatch = path.match(/^\/api\/scouts\/([a-f0-9-]+)$/);
      if (getMatch && request.method === "GET") {
        return withCors(await handleGetScout(getMatch[1], env));
      }

      // ── DELETE /api/scouts/:id — cancel a scout ─────────────────
      const deleteMatch = path.match(/^\/api\/scouts\/([a-f0-9-]+)$/);
      if (deleteMatch && request.method === "DELETE") {
        return withCors(await handleDeleteScout(deleteMatch[1], env));
      }

      // ── Fallthrough: 404 for unmatched /api routes ──────────────
      if (path.startsWith("/api/")) {
        return withCors(Response.json({ error: "Not found" }, { status: 404 }));
      }

      // ── Everything else: SPA assets handled by Cloudflare ───────
      return new Response(null, { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error("API error:", err);
      return withCors(Response.json({ error: message }, { status: 500 }));
    }
  },
} satisfies ExportedHandler<Env>;

// ── Route handlers ──────────────────────────────────────────────────

async function handleCreateScout(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json()) as CreateScoutRequest;

  if (!body.query?.trim()) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  if (!body.email?.trim() || !body.email.includes("@")) {
    return Response.json({ error: "valid email is required" }, { status: 400 });
  }

  const scoutId = crypto.randomUUID();

  // Source discovery: Google News search URL (dynamic—new articles appear when we poll)
  const sources = await discoverSources(env.AI, body.query.trim());

  const config: ScoutConfig = {
    scoutId,
    query: body.query.trim(),
    email: body.email.trim(),
    sources,
    createdAt: new Date().toISOString(),
  };

  // Save config to Durable Object
  const doId = env.SCOUT_DO.idFromName(scoutId);
  const stub = env.SCOUT_DO.get(doId);
  await stub.fetch(
    new Request("http://do/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),
  );

  // Start the polling workflow
  await env.SCOUT_WORKFLOW.create({
    id: scoutId,
    params: { scoutId },
  });

  const response: CreateScoutResponse = { scoutId };
  return Response.json(response, { status: 201 });
}

async function handleGetScout(scoutId: string, env: Env): Promise<Response> {
  const doId = env.SCOUT_DO.idFromName(scoutId);
  const stub = env.SCOUT_DO.get(doId);

  // Get config
  const configRes = await stub.fetch(new Request("http://do/config"));
  if (!configRes.ok) {
    return Response.json({ error: "Scout not found" }, { status: 404 });
  }
  const config = (await configRes.json()) as ScoutConfig;

  // Get events
  const eventsRes = await stub.fetch(new Request("http://do/events"));
  const events = (await eventsRes.json()) as ScoutEvent[];

  const response: ScoutStatusResponse = { config, events };
  return Response.json(response);
}

async function handleDeleteScout(scoutId: string, env: Env): Promise<Response> {
  // Terminate the workflow
  try {
    const instance = await env.SCOUT_WORKFLOW.get(scoutId);
    await instance.terminate();
  } catch {
    // Workflow may not exist or already completed — that's fine
  }

  // Wipe DO storage so the scout is fully removed
  try {
    const doId = env.SCOUT_DO.idFromName(scoutId);
    const stub = env.SCOUT_DO.get(doId);
    await stub.fetch(new Request("http://do/wipe", { method: "POST" }));
  } catch {
    // DO may not exist — that's fine
  }

  return Response.json({ ok: true, scoutId });
}

// ── CORS helpers ────────────────────────────────────────────────────

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

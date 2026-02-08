import { DurableObject } from "cloudflare:workers";
import type { ScoutConfig, ScoutEvent, Source, SourceSnapshot } from "./types";

/**
 * One Durable Object per scout.
 * Uses SQLite storage for config, sources, snapshots, and events.
 */
export class ScoutDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate();
  }

  /** Create tables if they don't exist */
  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS config (
        scoutId    TEXT PRIMARY KEY,
        query      TEXT NOT NULL,
        email      TEXT NOT NULL,
        createdAt  TEXT NOT NULL,
        expiresAt  TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS sources (
        url           TEXT PRIMARY KEY,
        label         TEXT NOT NULL,
        strategy      TEXT NOT NULL DEFAULT 'html_diff',
        lastHash      TEXT NOT NULL DEFAULT '',
        lastText      TEXT NOT NULL DEFAULT '',
        lastCheckedAt TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS events (
        eventId     TEXT PRIMARY KEY,
        sourceUrl   TEXT NOT NULL,
        sourceLabel TEXT NOT NULL,
        summary     TEXT NOT NULL,
        tldr        TEXT NOT NULL DEFAULT '',
        highlights  TEXT NOT NULL DEFAULT '[]',
        articles    TEXT NOT NULL DEFAULT '[]',
        isBreaking  INTEGER NOT NULL DEFAULT 0,
        detectedAt  TEXT NOT NULL,
        notified    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS email_counter (
        dateKey     TEXT PRIMARY KEY,
        count       INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Migration: add expiresAt column if it doesn't exist (for existing scouts)
    try {
      this.sql.exec(
        `ALTER TABLE config ADD COLUMN expiresAt TEXT NOT NULL DEFAULT ''`,
      );
    } catch {
      // Column already exists — fine
    }

    // Migration: add new event columns
    try {
      this.sql.exec(
        `ALTER TABLE events ADD COLUMN tldr TEXT NOT NULL DEFAULT ''`,
      );
    } catch {
      /* already exists */
    }
    try {
      this.sql.exec(
        `ALTER TABLE events ADD COLUMN highlights TEXT NOT NULL DEFAULT '[]'`,
      );
    } catch {
      /* already exists */
    }
    try {
      this.sql.exec(
        `ALTER TABLE events ADD COLUMN articles TEXT NOT NULL DEFAULT '[]'`,
      );
    } catch {
      /* already exists */
    }
    try {
      this.sql.exec(
        `ALTER TABLE events ADD COLUMN isBreaking INTEGER NOT NULL DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
  }

  /** Route internal requests */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Config ──────────────────────────────────────────────────
      if (path === "/config" && request.method === "POST") {
        return this.saveConfig(await request.json());
      }
      if (path === "/config" && request.method === "GET") {
        return this.getConfig();
      }

      // ── Snapshots ──────────────────────────────────────────────
      if (path === "/snapshot" && request.method === "GET") {
        const sourceUrl = url.searchParams.get("source") ?? "";
        return this.getSnapshot(sourceUrl);
      }
      if (path === "/snapshot" && request.method === "POST") {
        return this.saveSnapshot(await request.json());
      }

      // ── Events ─────────────────────────────────────────────────
      if (path === "/event" && request.method === "POST") {
        return this.recordEvent(await request.json());
      }
      if (path === "/events" && request.method === "GET") {
        return this.getEvents();
      }

      // ── Email counter ──────────────────────────────────────────
      if (path === "/email-count" && request.method === "GET") {
        return this.getEmailCount();
      }
      if (path === "/email-count" && request.method === "POST") {
        return this.incrementEmailCount();
      }

      // ── Wipe (clear all storage) ────────────────────────────────
      if (path === "/wipe" && request.method === "POST") {
        return this.wipe();
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  // ── Config ────────────────────────────────────────────────────────

  private saveConfig(body: ScoutConfig): Response {
    const { scoutId, query, email, sources, createdAt, expiresAt } = body;

    // Upsert config row
    this.sql.exec(
      `INSERT OR REPLACE INTO config (scoutId, query, email, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)`,
      scoutId,
      query,
      email,
      createdAt,
      expiresAt || "",
    );

    // Insert sources
    for (const src of sources) {
      this.sql.exec(
        `INSERT OR REPLACE INTO sources (url, label, strategy) VALUES (?, ?, ?)`,
        src.url,
        src.label,
        src.strategy,
      );
    }

    return Response.json({ ok: true });
  }

  private getConfig(): Response {
    const configRow = this.sql
      .exec(
        "SELECT scoutId, query, email, createdAt, expiresAt FROM config LIMIT 1",
      )
      .toArray()[0];

    if (!configRow) {
      return Response.json({ error: "No config" }, { status: 404 });
    }

    const sources = this.sql
      .exec("SELECT url, label, strategy FROM sources")
      .toArray() as unknown as Source[];

    const config: ScoutConfig = {
      scoutId: configRow.scoutId as string,
      query: configRow.query as string,
      email: configRow.email as string,
      createdAt: configRow.createdAt as string,
      expiresAt: (configRow.expiresAt as string) || "",
      sources,
    };

    return Response.json(config);
  }

  // ── Snapshots ─────────────────────────────────────────────────────

  private getSnapshot(sourceUrl: string): Response {
    const row = this.sql
      .exec(
        "SELECT url, lastHash AS contentHash, lastText AS text, lastCheckedAt AS checkedAt FROM sources WHERE url = ?",
        sourceUrl,
      )
      .toArray()[0];

    if (!row) {
      return Response.json(null);
    }

    return Response.json(row as unknown as SourceSnapshot);
  }

  private saveSnapshot(body: {
    url: string;
    contentHash: string;
    text: string;
  }): Response {
    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE sources SET lastHash = ?, lastText = ?, lastCheckedAt = ? WHERE url = ?`,
      body.contentHash,
      body.text.slice(0, 5000), // cap stored text to 5KB
      now,
      body.url,
    );
    return Response.json({ ok: true });
  }

  // ── Events ────────────────────────────────────────────────────────

  private recordEvent(body: {
    eventId: string;
    sourceUrl: string;
    sourceLabel: string;
    summary: string;
    tldr: string;
    highlights: string[];
    articles: Array<{
      title: string;
      url: string;
      imageUrl?: string;
      snippet?: string;
    }>;
    isBreaking: boolean;
    detectedAt: string;
  }): Response {
    // Idempotency: if eventId already exists, skip
    const existing = this.sql
      .exec("SELECT eventId FROM events WHERE eventId = ?", body.eventId)
      .toArray();

    if (existing.length > 0) {
      return Response.json({ ok: true, duplicate: true });
    }

    this.sql.exec(
      `INSERT INTO events (eventId, sourceUrl, sourceLabel, summary, tldr, highlights, articles, isBreaking, detectedAt, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      body.eventId,
      body.sourceUrl,
      body.sourceLabel,
      body.summary,
      body.tldr || "",
      JSON.stringify(body.highlights || []),
      JSON.stringify(body.articles || []),
      body.isBreaking ? 1 : 0,
      body.detectedAt,
    );

    return Response.json({ ok: true, duplicate: false });
  }

  private getEvents(): Response {
    const rows = this.sql
      .exec(
        "SELECT eventId, sourceUrl, sourceLabel, summary, tldr, highlights, articles, isBreaking, detectedAt, notified FROM events ORDER BY detectedAt DESC",
      )
      .toArray();

    const events: ScoutEvent[] = rows.map((r) => ({
      eventId: r.eventId as string,
      sourceUrl: r.sourceUrl as string,
      sourceLabel: r.sourceLabel as string,
      summary: r.summary as string,
      tldr: (r.tldr as string) || "",
      highlights: safeJsonParse(r.highlights as string, []),
      articles: safeJsonParse(r.articles as string, []),
      isBreaking: Boolean(r.isBreaking),
      detectedAt: r.detectedAt as string,
      notified: Boolean(r.notified),
    }));

    return Response.json(events);
  }

  // ── Email counter ─────────────────────────────────────────────────

  private getEmailCount(): Response {
    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const row = this.sql
      .exec("SELECT count FROM email_counter WHERE dateKey = ?", dateKey)
      .toArray()[0];
    const count = row ? (row.count as number) : 0;
    return Response.json({ dateKey, count });
  }

  private incrementEmailCount(): Response {
    const dateKey = new Date().toISOString().slice(0, 10);
    this.sql.exec(
      `INSERT INTO email_counter (dateKey, count) VALUES (?, 1)
       ON CONFLICT(dateKey) DO UPDATE SET count = count + 1`,
      dateKey,
    );
    // Clean up old date keys (keep only today)
    this.sql.exec("DELETE FROM email_counter WHERE dateKey != ?", dateKey);
    const row = this.sql
      .exec("SELECT count FROM email_counter WHERE dateKey = ?", dateKey)
      .toArray()[0];
    return Response.json({ dateKey, count: row ? (row.count as number) : 1 });
  }

  /** Clear all stored data (config, sources, events). Used when deleting a scout. */
  private wipe(): Response {
    this.sql.exec("DELETE FROM config");
    this.sql.exec("DELETE FROM sources");
    this.sql.exec("DELETE FROM events");
    this.sql.exec("DELETE FROM email_counter");
    return Response.json({ ok: true });
  }
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

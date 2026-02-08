import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { fetchPageText, hashText } from "./lib/fetcher";
import { analyzeChange } from "./lib/ai";
import { sendEventEmail } from "./lib/email";
import type { ScoutConfig, SourceSnapshot } from "./types";

interface WorkflowParams {
  scoutId: string;
}

const POLL_INTERVAL = "10 minutes";
const MAX_CYCLES = 200; // stay well under 1024-step limit

/**
 * ScoutWorkflow: the polling loop engine.
 *
 * Each scout gets one workflow instance that:
 *   1. Loads config from its Durable Object
 *   2. Fetches each source and diffs with last snapshot
 *   3. If diff detected, asks Workers AI if it's a real event
 *   4. If real event, records it and sends email via Resend
 *   5. Sleeps, then loops
 */
export class ScoutWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  override async run(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const { scoutId } = event.payload;

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // ── Step 1: Load config from DO ────────────────────────────
      const config = await step.do(`load-config-${cycle}`, async () => {
        const doId = this.env.SCOUT_DO.idFromName(scoutId);
        const stub = this.env.SCOUT_DO.get(doId);
        const res = await stub.fetch(new Request("http://do/config"));
        if (!res.ok) throw new Error("Failed to load scout config");
        return (await res.json()) as ScoutConfig;
      });

      // ── Step 2: Check each source ──────────────────────────────
      for (const source of config.sources) {
        // Fetch the page
        const fetchResult = await step.do(
          `fetch-${cycle}-${source.label}`,
          {
            retries: { limit: 2, delay: "5 seconds", backoff: "linear" },
            timeout: "30 seconds",
          },
          async () => {
            const text = await fetchPageText(source.url);
            const hash = await hashText(text);
            return { text, hash };
          },
        );

        // Get last snapshot from DO
        const lastSnapshot = await step.do(
          `snapshot-${cycle}-${source.label}`,
          async () => {
            const doId = this.env.SCOUT_DO.idFromName(scoutId);
            const stub = this.env.SCOUT_DO.get(doId);
            const url = `http://do/snapshot?source=${encodeURIComponent(source.url)}`;
            const res = await stub.fetch(new Request(url));
            return (await res.json()) as SourceSnapshot | null;
          },
        );

        const oldHash = lastSnapshot?.contentHash ?? "";
        const hasChanged = oldHash !== "" && oldHash !== fetchResult.hash;

        // Save updated snapshot regardless
        await step.do(
          `save-snapshot-${cycle}-${source.label}`,
          async () => {
            const doId = this.env.SCOUT_DO.idFromName(scoutId);
            const stub = this.env.SCOUT_DO.get(doId);
            await stub.fetch(
              new Request("http://do/snapshot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: source.url,
                  contentHash: fetchResult.hash,
                  text: fetchResult.text,
                }),
              }),
            );
          },
        );

        // If content changed, analyze with LLM
        if (hasChanged) {
          const analysis = await step.do(
            `analyze-${cycle}-${source.label}`,
            async () => {
              return analyzeChange(
                this.env.AI,
                config.query,
                lastSnapshot?.text ?? "",
                fetchResult.text,
              );
            },
          );

          if (analysis.is_event) {
            // Generate idempotent event ID
            const eventId = await step.do(
              `hash-event-${cycle}-${source.label}`,
              async () => {
                return hashText(`${source.url}|${oldHash}|${fetchResult.hash}`);
              },
            );

            // Record event in DO (idempotent)
            const recorded = await step.do(
              `record-event-${cycle}-${source.label}`,
              async () => {
                const doId = this.env.SCOUT_DO.idFromName(scoutId);
                const stub = this.env.SCOUT_DO.get(doId);
                const res = await stub.fetch(
                  new Request("http://do/event", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      eventId,
                      sourceUrl: source.url,
                      sourceLabel: source.label,
                      summary: analysis.summary,
                      detectedAt: new Date().toISOString(),
                    }),
                  }),
                );
                return (await res.json()) as { ok: boolean; duplicate: boolean };
              },
            );

            // Send email only if this is a new event (not duplicate)
            if (recorded.ok && !recorded.duplicate) {
              await step.do(
                `email-${cycle}-${source.label}`,
                {
                  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
                },
                async () => {
                  await sendEventEmail(
                    this.env.RESEND_API_KEY,
                    config.email,
                    config.query,
                    {
                      eventId,
                      sourceUrl: source.url,
                      sourceLabel: source.label,
                      summary: analysis.summary,
                      detectedAt: new Date().toISOString(),
                      notified: true,
                    },
                  );
                },
              );
            }
          }
        }
      }

      // ── Step 3: Sleep until next poll ──────────────────────────
      await step.sleep(`wait-${cycle}`, POLL_INTERVAL);
    }
  }
}

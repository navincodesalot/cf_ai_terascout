import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  env,
} from "cloudflare:workers";
import { fetchPageText, hashText } from "./lib/fetcher";
import { analyzeChange, isDuplicateEvent } from "./lib/ai";
import { sendEventEmail } from "./lib/email";
import { SCOUT_CONFIG } from "./config";
import type { ScoutConfig, ScoutEvent, SourceSnapshot } from "./types";

interface WorkflowParams {
  scoutId: string;
}

/**
 * ScoutWorkflow: the polling loop engine.
 *
 * Each scout gets one workflow instance that:
 *   1. Loads config from its Durable Object
 *   2. Checks if the scout has expired (hard stop)
 *   3. Fetches each source and saves snapshot
 *   4. After first poll (baseline), asks Workers AI to detect new content
 *   5. If new content + not duplicate + under email limit, records event and sends email via Resend
 *   6. Sleeps, then loops
 */
export class ScoutWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  override async run(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const { scoutId } = event.payload;

    for (let cycle = 0; cycle < SCOUT_CONFIG.maxCycles; cycle++) {
      // ── Step 1: Load config from DO ────────────────────────────
      const config = await step.do(`load-config-${cycle}`, async () => {
        const doId = env.SCOUT_DO.idFromName(scoutId);
        const stub = env.SCOUT_DO.get(doId);
        const res = await stub.fetch(new Request("http://do/config"));
        if (!res.ok) throw new Error("Failed to load scout config");
        return (await res.json()) as ScoutConfig;
      });

      // ── Step 2: Check hard stop (expiration) ───────────────────
      if (config.expiresAt) {
        const expiresMs = new Date(config.expiresAt).getTime();
        if (Date.now() >= expiresMs) {
          console.log(
            `[scout ${scoutId}] Expired at ${config.expiresAt}. Stopping.`,
          );
          return; // Hard stop — end workflow
        }
      }

      // ── Step 3: Check email rate limit for today ───────────────
      const emailCount = await step.do(`email-count-${cycle}`, async () => {
        const doId = env.SCOUT_DO.idFromName(scoutId);
        const stub = env.SCOUT_DO.get(doId);
        const res = await stub.fetch(new Request("http://do/email-count"));
        return (await res.json()) as { dateKey: string; count: number };
      });

      const canSendEmail =
        emailCount.count < SCOUT_CONFIG.maxEmailsPerScoutPerDay;

      // ── Step 4: Check each source ──────────────────────────────
      for (const source of config.sources) {
        // Fetch the page (skip source on failure — don't fail entire workflow)
        let fetchResult: { text: string; hash: string } | null = null;
        try {
          fetchResult = await step.do(
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
        } catch (err) {
          console.error(
            `[scout ${scoutId}] Source ${source.label} (${source.url}) failed:`,
            err,
          );
          continue; // skip this source, check others
        }

        if (!fetchResult) continue;

        // Get last snapshot from DO
        const lastSnapshot = await step.do(
          `snapshot-${cycle}-${source.label}`,
          async () => {
            const doId = env.SCOUT_DO.idFromName(scoutId);
            const stub = env.SCOUT_DO.get(doId);
            const url = `http://do/snapshot?source=${encodeURIComponent(source.url)}`;
            const res = await stub.fetch(new Request(url));
            return (await res.json()) as SourceSnapshot | null;
          },
        );

        const oldHash = lastSnapshot?.contentHash ?? "";
        const isFirstPoll = oldHash === "";

        // Save updated snapshot regardless
        await step.do(`save-snapshot-${cycle}-${source.label}`, async () => {
          const doId = env.SCOUT_DO.idFromName(scoutId);
          const stub = env.SCOUT_DO.get(doId);
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
        });

        // Always analyze after first poll (let LLM decide if content is new/different)
        if (!isFirstPoll) {
          const analysis = await step.do(
            `analyze-${cycle}-${source.label}`,
            async () => {
              return analyzeChange(
                env.AI,
                config.query,
                lastSnapshot?.text ?? "",
                fetchResult.text,
              );
            },
          );

          if (analysis.is_event) {
            // Check for semantic duplicate (same news as recent events)
            const isDuplicate = await step.do(
              `dedupe-${cycle}-${source.label}`,
              async () => {
                const doId = env.SCOUT_DO.idFromName(scoutId);
                const stub = env.SCOUT_DO.get(doId);
                const res = await stub.fetch(new Request("http://do/events"));
                const events = (await res.json()) as ScoutEvent[];
                const recentSummaries = events
                  .slice(0, SCOUT_CONFIG.dedupeLookback)
                  .map((e) => e.summary)
                  .filter(Boolean);
                return isDuplicateEvent(
                  env.AI,
                  analysis.summary,
                  recentSummaries,
                  config.query,
                );
              },
            );
            if (isDuplicate) continue; // skip—same news, no email

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
                const doId = env.SCOUT_DO.idFromName(scoutId);
                const stub = env.SCOUT_DO.get(doId);
                const res = await stub.fetch(
                  new Request("http://do/event", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      eventId,
                      sourceUrl: source.url,
                      sourceLabel: source.label,
                      summary: analysis.summary,
                      tldr: analysis.tldr,
                      highlights: analysis.highlights,
                      articles: analysis.articles,
                      isBreaking: analysis.is_breaking,
                      detectedAt: new Date().toISOString(),
                    }),
                  }),
                );
                return (await res.json()) as {
                  ok: boolean;
                  duplicate: boolean;
                };
              },
            );

            // Send email only if this is a new event AND under daily limit
            if (recorded.ok && !recorded.duplicate && canSendEmail) {
              await step.do(
                `email-${cycle}-${source.label}`,
                {
                  retries: {
                    limit: 3,
                    delay: "10 seconds",
                    backoff: "exponential",
                  },
                },
                async () => {
                  await sendEventEmail(
                    env.RESEND_API_KEY,
                    env.RESEND_FROM_EMAIL,
                    config.email,
                    config.query,
                    {
                      eventId,
                      sourceUrl: source.url,
                      sourceLabel: source.label,
                      summary: analysis.summary,
                      tldr: analysis.tldr,
                      highlights: analysis.highlights,
                      articles: analysis.articles,
                      isBreaking: analysis.is_breaking,
                      detectedAt: new Date().toISOString(),
                      notified: true,
                    },
                  );

                  // Increment email counter
                  const doId = env.SCOUT_DO.idFromName(scoutId);
                  const stub = env.SCOUT_DO.get(doId);
                  await stub.fetch(
                    new Request("http://do/email-count", { method: "POST" }),
                  );
                },
              );
            }
          }
        }
      }

      // ── Step 5: Sleep until next poll ──────────────────────────
      await step.sleep(`wait-${cycle}`, SCOUT_CONFIG.pollInterval);
    }
  }
}

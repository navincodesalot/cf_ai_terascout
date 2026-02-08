/**
 * Scout configuration defaults.
 * Edit these values to quickly change scout behavior.
 */
export const SCOUT_CONFIG = {
  /** Maximum emails a single scout can send per day */
  maxEmailsPerScoutPerDay: 10,

  /** Default scout lifetime if no end time is specified (in hours) */
  defaultLifetimeHours: 72, // 3 days

  /** Maximum scout lifetime allowed (in hours) */
  maxLifetimeHours: 168, // 7 days

  /** Polling interval between checks */
  pollInterval: "10 minutes" as const,

  /** Max polling cycles per workflow run */
  maxCycles: 200,

  /** Max stored text per source snapshot (bytes) */
  maxSnapshotTextLength: 5000,

  /** Max text length sent to AI for analysis (chars) */
  maxAiTextLength: 2500,

  /** Max recent events to check for deduplication */
  dedupeLookback: 5,
} as const;

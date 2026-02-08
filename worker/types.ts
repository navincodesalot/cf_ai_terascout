// ── Source: a single URL the scout watches ──────────────────────────
export interface Source {
  url: string;
  label: string;
  strategy: "html_diff";
}

// ── Scout config: persisted in DO on creation ───────────────────────
export interface ScoutConfig {
  scoutId: string;
  query: string;
  email: string;
  sources: Source[];
  createdAt: string; // ISO timestamp
}

// ── Scout event: one per detected state transition ──────────────────
export interface ScoutEvent {
  eventId: string; // hash(sourceUrl + oldHash + newHash)
  sourceUrl: string;
  sourceLabel: string;
  summary: string;
  detectedAt: string; // ISO timestamp
  notified: boolean;
}

// ── Snapshot: stored per-source for diffing ─────────────────────────
export interface SourceSnapshot {
  url: string;
  contentHash: string;
  text: string; // last fetched text (trimmed)
  checkedAt: string; // ISO timestamp
}

// ── AI response types ───────────────────────────────────────────────
export interface SourceDiscoveryResult {
  event_type: string;
  sources: Source[];
}

export interface ChangeAnalysisResult {
  is_event: boolean;
  summary: string;
}

// ── API request / response shapes ───────────────────────────────────
export interface CreateScoutRequest {
  query: string;
  email: string;
}

export interface CreateScoutResponse {
  scoutId: string;
}

export interface ScoutStatusResponse {
  config: ScoutConfig;
  events: ScoutEvent[];
}

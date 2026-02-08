// ── Source: a single URL the scout watches ──────────────────────────
export interface Source {
  url: string;
  label: string;
  strategy: "html_diff";
}

// ── Article: individual article extracted from a source page ─────────
export interface Article {
  title: string;
  url: string;
  imageUrl?: string;
  snippet?: string;
}

// ── Scout config: persisted in DO on creation ───────────────────────
export interface ScoutConfig {
  scoutId: string;
  query: string;
  email: string;
  sources: Source[];
  createdAt: string; // ISO timestamp
  expiresAt: string; // ISO timestamp — hard stop, scout stops reporting after this
}

// ── Scout event: one per detected state transition ──────────────────
export interface ScoutEvent {
  eventId: string; // hash(sourceUrl + oldHash + newHash)
  sourceUrl: string;
  sourceLabel: string;
  summary: string;
  tldr: string; // short 1-line summary
  highlights: string[]; // key points / what changed
  articles: Article[]; // individual articles found
  isBreaking: boolean; // whether this is breaking news
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
  tldr: string;
  highlights: string[];
  articles: Article[];
  is_breaking: boolean;
}

// ── API request / response shapes ───────────────────────────────────
export interface CreateScoutRequest {
  query: string;
  email: string;
  expiresAt?: string; // ISO timestamp, optional — frontend sends parsed value
}

export interface CreateScoutResponse {
  scoutId: string;
}

export interface ScoutStatusResponse {
  config: ScoutConfig;
  events: ScoutEvent[];
}

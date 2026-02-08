import type { Source, ChangeAnalysisResult, Article } from "../types";
import { SCOUT_CONFIG } from "../config";

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

/**
 * Always use search URLs (Google News) as sources.
 * Search pages are dynamic—new articles appear when we poll. No fixed article URLs.
 * (Tavily returns article URLs which rarely update; we avoid those.)
 */
export async function discoverSources(
  ai: Ai,
  query: string,
): Promise<Source[]> {
  return getSearchSources(ai, query);
}

/**
 * Event Analysis — richer version.
 *
 * When a page diff is detected, the LLM decides whether it's a
 * meaningful event and extracts:
 *   - TLDR (one-liner)
 *   - Detailed summary
 *   - Key highlights / what changed
 *   - Article info (titles, URLs, images)
 *   - Whether it's breaking news
 */
export async function analyzeChange(
  ai: Ai,
  query: string,
  oldText: string,
  newText: string,
): Promise<ChangeAnalysisResult> {
  const maxLen = SCOUT_CONFIG.maxAiTextLength;
  const oldTrunc = oldText.slice(0, maxLen);
  const newTrunc = newText.slice(0, maxLen);

  const prompt = `You are an event detection and news analysis system. A user is monitoring for:

"${query}"

A web page (Google News search results) has changed. Here is the OLD content (excerpt):
---
${oldTrunc}
---

Here is the NEW content (excerpt):
---
${newTrunc}
---

Determine if this change represents a meaningful event related to the user's intent.
Ignore minor changes like timestamps, ad rotations, session IDs, or layout tweaks.
Focus on substantive changes: new articles, new headlines, price drops, announcements, etc.

If it IS a meaningful event, extract the following:
1. "tldr": A single-sentence headline summary (max 15 words)
2. "summary": A detailed 2-4 sentence description of what happened, what changed, and why it matters
3. "highlights": An array of 2-5 key bullet points about what's new or changed
4. "articles": An array of articles you can identify from the new content. For each article include:
   - "title": the article headline
   - "url": the article URL if visible in the content (or empty string if not)
   - "snippet": a 1-sentence description of the article
5. "is_breaking": true if this seems like breaking or urgent news, false otherwise

Return ONLY valid JSON:
{"is_event": true, "tldr": "...", "summary": "...", "highlights": ["...", "..."], "articles": [{"title": "...", "url": "...", "snippet": "..."}], "is_breaking": true/false}

If the change is NOT meaningful, return:
{"is_event": false, "tldr": "", "summary": "no meaningful change detected", "highlights": [], "articles": [], "is_breaking": false}`;

  const response = await ai.run(MODEL, {
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text = "response" in response ? (response.response ?? "") : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        is_event: false,
        summary: "Could not parse AI response",
        tldr: "",
        highlights: [],
        articles: [],
        is_breaking: false,
      };
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      is_event?: boolean;
      tldr?: string;
      summary?: string;
      highlights?: string[];
      articles?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
        imageUrl?: string;
      }>;
      is_breaking?: boolean;
    };

    // Sanitize articles
    const articles: Article[] = (parsed.articles || [])
      .filter((a) => a.title)
      .map((a) => ({
        title: a.title || "Untitled",
        url: a.url || "",
        snippet: a.snippet || "",
        imageUrl: a.imageUrl || undefined,
      }));

    return {
      is_event: Boolean(parsed.is_event),
      summary: parsed.summary || "Change detected",
      tldr: parsed.tldr || (parsed.summary || "Change detected").slice(0, 80),
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter(Boolean)
        : [],
      articles,
      is_breaking: Boolean(parsed.is_breaking),
    };
  } catch {
    return {
      is_event: false,
      summary: "Could not parse AI response",
      tldr: "",
      highlights: [],
      articles: [],
      is_breaking: false,
    };
  }
}

/**
 * Check if a new event is about the same news as any recent event.
 * Prevents multiple emails for the same story (e.g. same headline from different polls).
 */
export async function isDuplicateEvent(
  ai: Ai,
  newSummary: string,
  previousSummaries: string[],
  query: string,
): Promise<boolean> {
  if (previousSummaries.length === 0) return false;

  const recent = previousSummaries
    .slice(0, SCOUT_CONFIG.dedupeLookback)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  const prompt = `A user is monitoring for: "${query}"

NEW event summary: "${newSummary}"

RECENT events we already notified about:
${recent}

Is the NEW event about the SAME news/story as any of the RECENT events? (e.g. same headline, same announcement, same development—just detected again or rephrased)

Return ONLY valid JSON:
{"is_duplicate": true/false}

If it's clearly the same underlying news, return: {"is_duplicate": true}
If it's different news, return: {"is_duplicate": false}`;

  try {
    const response = await ai.run(MODEL, {
      messages: [{ role: "user", content: prompt }],
    });
    const text = "response" in response ? (response.response ?? "") : "";
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return false; // on parse fail, allow through (don't over-dedupe)
    const parsed = JSON.parse(jsonMatch[0]) as { is_duplicate?: boolean };
    return Boolean(parsed.is_duplicate);
  } catch {
    return false;
  }
}

/** Google News supports when:Xh, when:Xd, when:Xm in the query */
const TIME_RANGES = ["1d", "7d", "30d"] as const;
type TimeRange = (typeof TIME_RANGES)[number] | null;

export interface SearchQueryResult {
  query: string;
  timeRange: TimeRange;
}

/**
 * Extract search query from user intent → use Google News search URL.
 * The search page is dynamic: new articles appear when we poll, so we're not
 * stuck with fixed sources. One source per scout, always fresh.
 */
async function getSearchSources(ai: Ai, query: string): Promise<Source[]> {
  const { query: searchQuery, timeRange } = await extractSearchQueryWithTime(
    ai,
    query,
  );
  // Google News: append when:Xd to narrow by publish date (e.g. when:7d = past week)
  const fullQuery = timeRange
    ? `${searchQuery} when:${timeRange}`
    : searchQuery;
  const encoded = encodeURIComponent(fullQuery);
  const label = timeRange
    ? `Google News: ${searchQuery.slice(0, 35)} (${timeRange})`
    : `Google News: ${searchQuery.slice(0, 40)}`;
  return [
    {
      url: `https://news.google.com/search?q=${encoded}`,
      label,
      strategy: "html_diff",
    },
  ];
}

/**
 * Use the LLM to extract a short search query and optional time range.
 * Time-sensitive queries (breaking news, IPO, drops) get a filter; general topics don't.
 */
async function extractSearchQueryWithTime(
  ai: Ai,
  query: string,
): Promise<SearchQueryResult> {
  const prompt = `A user said: "${query}"

Extract a short search query (2-7 words) for Google News. Use only key terms—no filler like "lmk", "keep me updated", etc.

Also decide if this query is TIME-SENSITIVE (wants recent/breaking news) or GENERAL (any time is fine):
- Time-sensitive: IPO updates, stock drops, product launches, breaking news, "latest", "new", announcements → use a time filter
- General: background info, history, "how things are", ongoing topics → no time filter

Return ONLY valid JSON:
{"query": "search terms here", "time_range": "1d" | "7d" | "30d" | null}

Use time_range "1d" for very breaking (past day), "7d" for recent (past week), "30d" for past month. Use null for general (no filter).

Examples:
- "lmk about spacex IPO" → {"query":"spacex IPO","time_range":"7d"}
- "NVIDIA GPU drops" → {"query":"NVIDIA GPU drops","time_range":"7d"}
- "apple stock news" → {"query":"apple stock","time_range":"7d"}
- "history of tesla" → {"query":"tesla history","time_range":null}
- "general info on quantum computing" → {"query":"quantum computing","time_range":null}`;

  try {
    const response = await ai.run(MODEL, {
      messages: [{ role: "user", content: prompt }],
    });
    const text = (
      "response" in response ? (response.response ?? "") : ""
    ).trim();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return { query: query.slice(0, 80), timeRange: "7d" };
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      query?: string;
      time_range?: string | null;
    };
    const q = (parsed.query ?? query).trim().slice(0, 80);
    const tr = parsed.time_range;
    const timeRange: TimeRange =
      tr && TIME_RANGES.includes(tr as (typeof TIME_RANGES)[number])
        ? (tr as TimeRange)
        : null;
    return { query: q || query, timeRange };
  } catch {
    return { query: query.slice(0, 80), timeRange: "7d" };
  }
}

import type { Source } from "../types";

const TAVILY_API = "https://api.tavily.com/search";

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  response_time?: number;
}

/**
 * Use Tavily's web search API to discover real, current URLs.
 * Returns actual search results—no hallucinated URLs.
 */
export async function searchTavily(
  apiKey: string,
  query: string,
  options?: {
    maxResults?: number;
    topic?: "general" | "news" | "finance";
    searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
    timeRange?: "day" | "week" | "month" | "year";
  },
): Promise<TavilySearchResult[]> {
  const {
    maxResults = 5,
    topic = "news",
    searchDepth = "basic",
    timeRange = "week",
  } = options ?? {};

  const res = await fetch(TAVILY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      topic,
      search_depth: searchDepth,
      time_range: timeRange,
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as TavilySearchResponse;
  return data.results ?? [];
}

/**
 * Convert Tavily search results to Source objects for the scout workflow.
 * Filters out invalid URLs and deduplicates.
 */
export function tavilyResultsToSources(
  results: TavilySearchResult[],
  maxSources = 3,
): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];

  for (const r of results) {
    if (sources.length >= maxSources) break;
    if (!r.url || !r.url.startsWith("http")) continue;

    try {
      const u = new URL(r.url);
      const normalized = u.origin + u.pathname;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
    } catch {
      continue;
    }

    sources.push({
      url: r.url,
      label: r.title?.slice(0, 80) || new URL(r.url).hostname,
      strategy: "html_diff",
    });
  }

  return sources;
}

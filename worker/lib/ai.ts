import type { Source, SourceDiscoveryResult, ChangeAnalysisResult } from "../types";

const MODEL = "@cf/meta/llama-3.2-3b-instruct" as const;

/**
 * LLM Call 1: Intent → Sources
 *
 * Given a user's plain-English intent, returns 2-3 high-signal
 * public URLs to monitor. The LLM plans *what* to watch, not *how* to fetch.
 */
export async function discoverSources(
  ai: Ai,
  query: string,
): Promise<Source[]> {
  const prompt = `You are a web monitoring assistant. A user wants to track the following:

"${query}"

Your job is to return a JSON object with:
- "event_type": a short label for the kind of event (e.g. "product_availability", "news_release", "price_drop")
- "sources": an array of 2-3 public web pages that would be the best places to monitor for this event. Each source has:
  - "url": the full URL of a real, publicly accessible web page
  - "label": a short human-readable name for the source (e.g. "NVIDIA Store", "Best Buy")
  - "strategy": always "html_diff"

IMPORTANT:
- Only return real, valid, publicly accessible URLs
- Pick high-signal pages (product listing pages, official store pages, news pages)
- Do NOT return API endpoints or pages behind authentication
- Return ONLY valid JSON, no markdown, no explanation

Example response:
{"event_type":"product_availability","sources":[{"url":"https://store.nvidia.com/en-us/geforce/store/","label":"NVIDIA Store","strategy":"html_diff"},{"url":"https://www.bestbuy.com/site/searchpage.jsp?st=nvidia+gpu","label":"Best Buy","strategy":"html_diff"}]}`;

  const response = await ai.run(MODEL, {
    messages: [{ role: "user", content: prompt }],
  });

  try {
    // Extract JSON from the response (handle potential markdown wrapping)
    const text = "response" in response ? response.response ?? "" : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI source discovery: no JSON found in response:", text);
      return await getDefaultSources(ai, query);
    }

    const parsed = JSON.parse(jsonMatch[0]) as SourceDiscoveryResult;

    if (!parsed.sources || parsed.sources.length === 0) {
      return await getDefaultSources(ai, query);
    }

    // Validate and clean sources
    const sources = parsed.sources
      .filter((s) => s.url && s.label && s.url.startsWith("http"))
      .map((s) => ({
        url: sanitizeUrl(s.url),
        label: s.label,
        strategy: "html_diff" as const,
      }))
      .filter((s) => {
        try {
          new URL(s.url);
          return true;
        } catch {
          return false;
        }
      });

    if (sources.length === 0) {
      return await getDefaultSources(ai, query);
    }
    return sources;
  } catch (err) {
    console.error("AI source discovery parse error:", err);
    return await getDefaultSources(ai, query);
  }
}

/**
 * LLM Call 2: Change Analysis
 *
 * When a page diff is detected, the LLM decides whether it's a
 * meaningful event related to the user's query or just noise.
 */
export async function analyzeChange(
  ai: Ai,
  query: string,
  oldText: string,
  newText: string,
): Promise<ChangeAnalysisResult> {
  // Truncate texts to stay within token limits
  const maxLen = 1500;
  const oldTrunc = oldText.slice(0, maxLen);
  const newTrunc = newText.slice(0, maxLen);

  const prompt = `You are an event detection system. A user is monitoring for:

"${query}"

A web page has changed. Here is the OLD content (excerpt):
---
${oldTrunc}
---

Here is the NEW content (excerpt):
---
${newTrunc}
---

Determine if this change represents a meaningful event related to the user's intent.
Ignore minor changes like timestamps, ad rotations, session IDs, or layout tweaks.
Focus on substantive changes: new products, availability changes, price drops, announcements, etc.

Return ONLY valid JSON:
{"is_event": true/false, "summary": "one-sentence description of what changed"}

If the change is NOT meaningful, return:
{"is_event": false, "summary": "no meaningful change detected"}`;

  const response = await ai.run(MODEL, {
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text = "response" in response ? response.response ?? "" : "";
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return { is_event: false, summary: "Could not parse AI response" };
    }
    const parsed = JSON.parse(jsonMatch[0]) as ChangeAnalysisResult;
    return {
      is_event: Boolean(parsed.is_event),
      summary: parsed.summary || "Change detected",
    };
  } catch {
    return { is_event: false, summary: "Could not parse AI response" };
  }
}

/**
 * Fix common LLM URL mistakes: spaces instead of dots in domain, spaces in path.
 * e.g. "https://www espn com nfl news" → "https://www.espn.com/nfl/news"
 */
function sanitizeUrl(url: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    // Not a valid URL — fix spaces
  }
  let fixed = url.trim();
  // Replace " com " or " .com " etc. with ".com/" to separate domain from path
  const tlds = ["com", "org", "net", "io", "co", "edu", "gov"];
  for (const tld of tlds) {
    fixed = fixed.replace(
      new RegExp(`\\s+\\.?${tld}\\s+`, "gi"),
      `.${tld}/`,
    );
  }
  // In the host part (between // and next /), replace spaces with dots
  const match = fixed.match(/^(https?:\/\/)([^/]+)(\/.*)?$/);
  if (match) {
    const [, scheme, host, path = ""] = match;
    const fixedHost = host.replace(/\s+/g, ".");
    const fixedPath = path.replace(/\s+/g, "/");
    fixed = scheme + fixedHost + fixedPath;
  }
  return fixed;
}

/**
 * Fallback: if the LLM fails to discover sources, extract a search-friendly
 * query from the user's intent and use Google News.
 *
 * Conversational phrasing like "lmk how things are with X" yields poor results.
 * We ask the LLM for a condensed query (e.g. "spacex IPO") that works better.
 */
async function getDefaultSources(ai: Ai, query: string): Promise<Source[]> {
  const searchQuery = await extractSearchQuery(ai, query);
  const encoded = encodeURIComponent(searchQuery);
  return [
    {
      url: `https://news.google.com/search?q=${encoded}`,
      label: "Google News",
      strategy: "html_diff",
    },
  ];
}

/**
 * Use the LLM to extract a short, search-friendly query from the user's intent.
 * Removes conversational filler ("lmk", "how things are", etc.) and keeps key terms.
 */
async function extractSearchQuery(ai: Ai, query: string): Promise<string> {
  const prompt = `A user said: "${query}"

Extract a short search query (2-7 words) for a news search. Use only the key terms—no conversational phrasing like "lmk", "keep me updated", "how things are", etc. Just the topic.

Examples:
- "lmk how things are with spacex and their supposed IPO" → "spacex IPO"
- "keep me updated on NVIDIA GPU drops" → "NVIDIA GPU drops"
- "what's going on with apple stock" → "apple stock"

Return ONLY the search query, no quotes, no explanation.`;

  try {
    const response = await ai.run(MODEL, {
      messages: [{ role: "user", content: prompt }],
    });
    const text = ("response" in response ? response.response ?? "" : "").trim();
    // Take first line, strip quotes, limit length
    const cleaned = text
      .split("\n")[0]
      .replace(/^["']|["']$/g, "")
      .trim()
      .slice(0, 80);
    return cleaned || query;
  } catch {
    return query;
  }
}

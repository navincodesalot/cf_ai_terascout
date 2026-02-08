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
      return getDefaultSources(query);
    }

    const parsed = JSON.parse(jsonMatch[0]) as SourceDiscoveryResult;

    if (!parsed.sources || parsed.sources.length === 0) {
      return getDefaultSources(query);
    }

    // Validate and clean sources
    return parsed.sources
      .filter((s) => s.url && s.label && s.url.startsWith("http"))
      .map((s) => ({
        url: s.url,
        label: s.label,
        strategy: "html_diff" as const,
      }));
  } catch (err) {
    console.error("AI source discovery parse error:", err);
    return getDefaultSources(query);
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
 * Fallback: if the LLM fails to discover sources, generate
 * a reasonable Google News search URL for the query.
 */
function getDefaultSources(query: string): Source[] {
  const encoded = encodeURIComponent(query);
  return [
    {
      url: `https://news.google.com/search?q=${encoded}`,
      label: "Google News",
      strategy: "html_diff",
    },
  ];
}

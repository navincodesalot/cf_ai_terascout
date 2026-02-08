import type { Source } from "../types";

/**
 * Validate that a URL is reachable (returns 2xx).
 * Uses HEAD request to avoid downloading full page.
 */
export async function validateUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Terascout/1.0; +https://terascout.dev)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    // Try GET if HEAD fails (some servers block HEAD)
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Terascout/1.0; +https://terascout.dev)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Filter sources to only those that are reachable.
 * Validates in parallel with concurrency limit.
 */
export async function filterValidSources(
  sources: Source[],
  maxConcurrent = 3,
): Promise<Source[]> {
  const results: Source[] = [];
  const validate = async (source: Source) => {
    const ok = await validateUrl(source.url);
    return ok ? source : null;
  };

  for (let i = 0; i < sources.length; i += maxConcurrent) {
    const batch = sources.slice(i, i + maxConcurrent);
    const validated = await Promise.all(batch.map(validate));
    results.push(...validated.filter((s): s is Source => s !== null));
  }

  return results;
}

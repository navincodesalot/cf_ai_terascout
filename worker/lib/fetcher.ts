const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL and extract visible text from the HTML.
 * Retries on 429 (Too Many Requests) with exponential backoff.
 * Adds jitter before each attempt to spread concurrent requests.
 */
export async function fetchPageText(url: string): Promise<string> {
  const isNewsGoogle = url.startsWith("https://news.google.com");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Jitter: add 0–3s delay before fetch to spread concurrent requests
    if (isNewsGoogle) {
      const jitter = Math.floor(Math.random() * 3000);
      await sleep(jitter);
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Terascout/1.0; +https://terascout.dev)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Fetch failed for ${url}: 429 Too Many Requests (rate limited after ${MAX_RETRIES + 1} attempts)`,
        );
      }
      const retryAfter = res.headers.get("Retry-After");
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(Math.min(delayMs, 60_000)); // cap at 60s
      continue;
    }

    if (!res.ok) {
      throw new Error(
        `Fetch failed for ${url}: ${res.status} ${res.statusText}`,
      );
    }

    const html = await res.text();
    return extractText(html);
  }

  throw new Error(`Fetch failed for ${url}: unexpected`);
}

/**
 * Strip HTML to extract visible text.
 * Removes scripts, styles, tags, and excess whitespace.
 */
function extractText(html: string): string {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Inline anchor hrefs so URLs are visible in the plain text.
  // This lets downstream LLM prompts copy real article URLs from Google News
  // instead of inventing them.
  text = text.replace(
    /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href, inner) => {
      return `${inner} ${href}`;
    },
  );

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#x2F;/g, "/");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Cap at 10KB to keep things sane
  return text.slice(0, 10_000);
}

/**
 * Simple SHA-256 hash of a string, returned as hex.
 * Used to detect content changes between polls.
 */
export async function hashText(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

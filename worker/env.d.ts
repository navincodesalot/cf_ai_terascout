/** Extend Cloudflare Env with optional secrets (set via wrangler secret put) */
declare namespace Cloudflare {
  interface Env {
    TAVILY_API_KEY?: string;
  }
}

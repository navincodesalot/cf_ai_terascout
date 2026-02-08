import { Resend } from "resend";
import type { ScoutEvent, Article } from "../types";

/**
 * Send an event notification email via Resend.
 * Rich HTML with TLDR, detailed summary, highlights, and article links.
 */
export async function sendEventEmail(
  apiKey: string,
  to: string,
  scoutQuery: string,
  event: ScoutEvent,
): Promise<void> {
  const resend = new Resend(apiKey);

  const subjectPrefix = event.isBreaking ? "BREAKING" : "Update";
  const subjectText = event.tldr || event.summary.slice(0, 80);

  await resend.emails.send({
    from: "Terascout <onboarding@resend.dev>",
    to,
    subject: `Terascout ${subjectPrefix}: ${subjectText}`,
    html: buildEmailHtml(scoutQuery, event),
  });
}

function buildEmailHtml(query: string, event: ScoutEvent): string {
  const highlightsHtml =
    event.highlights.length > 0
      ? `
    <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1a1; margin: 0 0 12px 0;">Key Highlights</p>
      <ul style="margin: 0; padding: 0 0 0 18px;">
        ${event.highlights.map((h) => `<li style="font-size: 14px; color: #e0e0e0; margin-bottom: 6px; line-height: 1.5;">${escapeHtml(h)}</li>`).join("")}
      </ul>
    </div>`
      : "";

  const articlesHtml =
    event.articles.length > 0
      ? `
    <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1a1; margin: 0 0 12px 0;">Related Articles</p>
      ${event.articles.map((a) => buildArticleHtml(a)).join("")}
    </div>`
      : "";

  const breakingBanner = event.isBreaking
    ? `<div style="background: #dc2626; color: #fff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 16px; border-radius: 6px; margin-bottom: 16px; text-align: center;">Breaking News</div>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px; background: #0a0a0a; color: #fafafa;">
  <div style="margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 4px 0; color: #fafafa;">Terascout Alert</h1>
    <p style="font-size: 13px; color: #a1a1a1; margin: 0;">Event detected for your scout</p>
  </div>

  ${breakingBanner}

  <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1a1; margin: 0 0 8px 0;">Watching for</p>
    <p style="font-size: 16px; font-weight: 500; color: #fafafa; margin: 0;">${escapeHtml(query)}</p>
  </div>

  <!-- TLDR -->
  <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #60a5fa; margin: 0 0 8px 0; font-weight: 600;">TL;DR</p>
    <p style="font-size: 16px; font-weight: 600; color: #fafafa; margin: 0; line-height: 1.4;">${escapeHtml(event.tldr || event.summary.slice(0, 120))}</p>
  </div>

  <!-- Detailed Summary -->
  <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1a1; margin: 0 0 8px 0;">What Happened</p>
    <p style="font-size: 15px; color: #e0e0e0; margin: 0; line-height: 1.6;">${escapeHtml(event.summary)}</p>
  </div>

  <!-- Highlights -->
  ${highlightsHtml}

  <!-- Articles -->
  ${articlesHtml}

  <!-- Source & timestamp -->
  <div style="border-top: 1px solid #2a2a2a; padding-top: 16px; margin-top: 8px;">
    <p style="font-size: 13px; color: #a1a1a1; margin: 0;">
      Source: <a href="${escapeHtml(event.sourceUrl)}" style="color: #60a5fa; text-decoration: none;">${escapeHtml(event.sourceLabel)}</a>
    </p>
    <p style="font-size: 12px; color: #666; margin: 8px 0 0 0;">
      Detected at ${new Date(event.detectedAt).toUTCString()}
    </p>
  </div>

  <p style="font-size: 11px; color: #555; margin-top: 24px;">
    Powered by Terascout on Cloudflare Workers
  </p>
</body>
</html>`;
}

function buildArticleHtml(article: Article): string {
  const imageHtml = article.imageUrl
    ? `<img src="${escapeHtml(article.imageUrl)}" alt="" style="width: 100%; max-height: 160px; object-fit: cover; border-radius: 6px; margin-bottom: 10px;" />`
    : "";

  const titleHtml = article.url
    ? `<a href="${escapeHtml(article.url)}" style="color: #60a5fa; text-decoration: none; font-size: 14px; font-weight: 600; line-height: 1.4;">${escapeHtml(article.title)}</a>`
    : `<span style="color: #fafafa; font-size: 14px; font-weight: 600; line-height: 1.4;">${escapeHtml(article.title)}</span>`;

  const snippetHtml = article.snippet
    ? `<p style="font-size: 13px; color: #a1a1a1; margin: 4px 0 0 0; line-height: 1.4;">${escapeHtml(article.snippet)}</p>`
    : "";

  return `
    <div style="margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #2a2a2a;">
      ${imageHtml}
      <div>
        ${titleHtml}
        ${snippetHtml}
      </div>
    </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import { Resend } from "resend";
import type { ScoutEvent } from "../types";

/**
 * Send an event notification email via Resend.
 * One email per event. Clean, minimal HTML.
 */
export async function sendEventEmail(
  apiKey: string,
  to: string,
  scoutQuery: string,
  event: ScoutEvent,
): Promise<void> {
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: "Terascout <onboarding@resend.dev>",
    to,
    subject: `Terascout: ${event.summary.slice(0, 80)}`,
    html: buildEmailHtml(scoutQuery, event),
  });
}

function buildEmailHtml(query: string, event: ScoutEvent): string {
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

  <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1a1; margin: 0 0 8px 0;">Watching for</p>
    <p style="font-size: 16px; font-weight: 500; color: #fafafa; margin: 0;">${escapeHtml(query)}</p>
  </div>

  <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1a1; margin: 0 0 8px 0;">What happened</p>
    <p style="font-size: 15px; color: #fafafa; margin: 0 0 12px 0;">${escapeHtml(event.summary)}</p>
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

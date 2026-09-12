import fetch from "node-fetch";
import crypto from "crypto";
import { config } from "../../config";

const BASE = `https://graph.facebook.com/${config.meta.graphApiVersion}`;

/**
 * Sends a text message via the Meta Send API. Works for both Facebook Messenger
 * and Instagram Direct — the payload shape is identical, only the recipient id
 * (PSID vs IGSID) and page access token differ per surface/tenant.
 */
export async function sendMetaMessage(recipientId: string, text: string, pageAccessToken: string): Promise<void> {
  const url = `${BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: "RESPONSE",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[meta] send failed: ${res.status} ${body}`);
  }
}

/**
 * Verifies the X-Hub-Signature-256 header Meta sends on every webhook POST,
 * to confirm the payload actually came from Meta and wasn't forged. This is
 * app-level (config.meta.appSecret), shared across all tenants, since it's
 * the same Meta app receiving webhooks for every tenant's Page.
 */
export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!config.meta.appSecret) return true; // signature check skipped if secret isn't configured
  if (!signatureHeader) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", config.meta.appSecret).update(rawBody).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

import fetch from "node-fetch";
import crypto from "crypto";
import { config } from "../../config";

const BASE = `https://graph.facebook.com/${config.meta.graphApiVersion}`;
const INSTAGRAM_BASE = `https://graph.instagram.com/${config.meta.graphApiVersion}`;

async function sendViaSendApi(base: string, recipientId: string, text: string, accessToken: string): Promise<void> {
  const url = `${base}/me/messages?access_token=${encodeURIComponent(accessToken)}`;
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
 * Sends a text message via the Meta Send API. Works for Facebook Messenger
 * and Instagram Direct connected through Facebook Login — the payload shape
 * is identical, only the recipient id (PSID vs IGSID) and page access token
 * differ per surface/tenant. For Instagram accounts connected via the
 * native Instagram Login flow instead, use sendInstagramMessage below (the
 * access token is only valid against graph.instagram.com, not
 * graph.facebook.com).
 */
export function sendMetaMessage(recipientId: string, text: string, pageAccessToken: string): Promise<void> {
  return sendViaSendApi(BASE, recipientId, text, pageAccessToken);
}

/**
 * Sends an Instagram DM using an Instagram user access token obtained via
 * the native Instagram Login flow (Tenant.instagram.authMethod === "instagram").
 */
export function sendInstagramMessage(recipientId: string, text: string, instagramAccessToken: string): Promise<void> {
  return sendViaSendApi(INSTAGRAM_BASE, recipientId, text, instagramAccessToken);
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

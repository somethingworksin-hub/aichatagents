import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/**
 * Only settings shared across every tenant live here — the platform's Meta
 * app, WhatsApp app, and Google OAuth client. Everything specific to a
 * single client (AI provider/key, persona, page/phone ids, per-channel
 * tokens) lives on their Tenant document in Firestore (src/core/tenant.ts).
 */
export const config = {
  port: Number(process.env.PORT || 3000),

  // Protects the tenant-management API (POST/GET/PATCH /admin/tenants/...).
  adminApiKey: required("ADMIN_API_KEY"),

  meta: {
    verifyToken: required("META_VERIFY_TOKEN"),
    appSecret: required("META_APP_SECRET"),
    graphApiVersion: required("META_GRAPH_API_VERSION", "v21.0"),
    // Needed for the "Connect Facebook/Instagram" OAuth button (Facebook Login),
    // in addition to appSecret above. Not needed if you only ever paste
    // Page IDs/tokens in manually.
    appId: required("META_APP_ID"),
  },

  whatsapp: {
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    graphApiVersion: required("WHATSAPP_GRAPH_API_VERSION", "v21.0"),
  },

  gmail: {
    clientId: required("GMAIL_CLIENT_ID"),
    clientSecret: required("GMAIL_CLIENT_SECRET"),
    redirectUri: required("GMAIL_REDIRECT_URI", "http://localhost:3000/gmail/oauth2callback"),
    labelToWatch: required("GMAIL_LABEL_TO_WATCH", "INBOX"),
    // Shared secret for POST /gmail/poll, so Cloud Scheduler (or any external
    // cron) can trigger a poll on a serverless host without leaving a
    // long-running process around. Leave blank to disable that endpoint.
    cronSecret: required("GMAIL_CRON_SECRET"),
  },
};

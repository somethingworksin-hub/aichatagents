import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(process.env.PORT || 3000),

  ai: {
    // "anthropic" (Claude) or "openai" (GPT). Pick whichever key you have.
    provider: required("AI_PROVIDER", "anthropic").toLowerCase() as "anthropic" | "openai",
  },

  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: required("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929"),
  },

  openai: {
    apiKey: required("OPENAI_API_KEY"),
    model: required("OPENAI_MODEL", "gpt-4o-mini"),
  },

  bot: {
    name: required("BOT_NAME", "Assistant"),
    persona: required(
      "BOT_PERSONA",
      "You are a friendly, concise support assistant. Answer helpfully and admit when you don't know something."
    ),
  },

  website: {
    allowedOrigins: required("WEBSITE_ALLOWED_ORIGINS", "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  meta: {
    verifyToken: required("META_VERIFY_TOKEN"),
    pageAccessToken: required("META_PAGE_ACCESS_TOKEN"),
    appSecret: required("META_APP_SECRET"),
    graphApiVersion: required("META_GRAPH_API_VERSION", "v21.0"),
  },

  whatsapp: {
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    graphApiVersion: required("WHATSAPP_GRAPH_API_VERSION", "v21.0"),
  },

  gmail: {
    clientId: required("GMAIL_CLIENT_ID"),
    clientSecret: required("GMAIL_CLIENT_SECRET"),
    redirectUri: required("GMAIL_REDIRECT_URI", "http://localhost:3000/gmail/oauth2callback"),
    ignoreSenders: required("GMAIL_IGNORE_SENDERS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    pollIntervalMs: Number(process.env.GMAIL_POLL_INTERVAL_MS || 60000),
    labelToWatch: required("GMAIL_LABEL_TO_WATCH", "INBOX"),
  },
};

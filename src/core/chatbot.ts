import { Tenant } from "./tenant";
import { getHistory, appendMessages } from "./conversationStore";
import { callLLM } from "./llmProvider";
import { retrieveContext } from "./knowledgeBase";

export type Channel = "website" | "facebook" | "instagram" | "whatsapp" | "gmail";

const DEFAULT_MODEL: Record<Tenant["ai"]["provider"], string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o-mini",
};

function systemPrompt(tenant: Tenant, channel: Channel): string {
  const channelNotes: Record<Channel, string> = {
    website: "You are replying inside a live chat widget on the company website. Keep replies short and scannable.",
    facebook: "You are replying inside Facebook Messenger. Keep replies conversational and short.",
    instagram: "You are replying inside Instagram Direct Messages. Keep replies casual, friendly, and short.",
    whatsapp: "You are replying inside WhatsApp. Keep replies short; avoid heavy markdown since it won't render.",
    gmail: "You are drafting an email reply. Use a clear greeting, a helpful body, and a brief sign-off. Plain text only.",
  };

  return [
    tenant.bot.persona,
    `Your name is ${tenant.bot.name}.`,
    channelNotes[channel],
    "If you don't know the answer or the request needs a human, say so plainly instead of guessing.",
  ].join("\n");
}

export interface ReplyOptions {
  tenant: Tenant;
  channel: Channel;
  userId: string; // stable id for this user on this channel (PSID, wa_id, email address, session id, etc.)
  message: string;
  extraSystemContext?: string; // e.g. subject line for email, page URL for website
}

/**
 * Generates a reply using this tenant's configured LLM provider/persona,
 * with per-tenant, per-user conversation memory scoped to the channel, and
 * grounded in this tenant's knowledge base when relevant.
 */
export async function generateReply({ tenant, channel, userId, message, extraSystemContext }: ReplyOptions): Promise<string> {
  const [history, knowledge] = await Promise.all([
    getHistory(tenant.id, channel, userId),
    retrieveContext(tenant.id, message),
  ]);

  const system = [systemPrompt(tenant, channel), extraSystemContext, knowledge].filter(Boolean).join("\n\n");

  const reply = await callLLM(
    {
      provider: tenant.ai.provider,
      apiKey: tenant.ai.apiKey,
      model: tenant.ai.model || DEFAULT_MODEL[tenant.ai.provider],
    },
    system,
    history,
    message
  );

  await appendMessages(tenant.id, channel, userId, [
    { role: "user", content: message, at: Date.now() },
    { role: "assistant", content: reply, at: Date.now() },
  ]);

  return reply;
}

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { conversationStore } from "./conversationStore";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export type Channel = "website" | "facebook" | "instagram" | "whatsapp" | "gmail";

function systemPrompt(channel: Channel): string {
  const channelNotes: Record<Channel, string> = {
    website: "You are replying inside a live chat widget on the company website. Keep replies short and scannable.",
    facebook: "You are replying inside Facebook Messenger. Keep replies conversational and short.",
    instagram: "You are replying inside Instagram Direct Messages. Keep replies casual, friendly, and short.",
    whatsapp: "You are replying inside WhatsApp. Keep replies short; avoid heavy markdown since it won't render.",
    gmail: "You are drafting an email reply. Use a clear greeting, a helpful body, and a brief sign-off. Plain text only.",
  };

  return [
    config.bot.persona,
    `Your name is ${config.bot.name}.`,
    channelNotes[channel],
    "If you don't know the answer or the request needs a human, say so plainly instead of guessing.",
  ].join("\n");
}

export interface ReplyOptions {
  channel: Channel;
  userId: string; // stable id for this user on this channel (PSID, wa_id, thread/email address, session id, etc.)
  message: string;
  extraSystemContext?: string; // e.g. subject line for email, page URL for website
}

/**
 * Generates a reply using Claude, with per-user conversation memory scoped to the channel.
 */
export async function generateReply({ channel, userId, message, extraSystemContext }: ReplyOptions): Promise<string> {
  const history = conversationStore.getHistory(channel, userId);

  const system = extraSystemContext ? `${systemPrompt(channel)}\n\n${extraSystemContext}` : systemPrompt(channel);

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    system,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const reply = textBlock && "text" in textBlock ? textBlock.text.trim() : "Sorry, I couldn't come up with a reply just now.";

  conversationStore.append(channel, userId, { role: "user", content: message, at: Date.now() });
  conversationStore.append(channel, userId, { role: "assistant", content: reply, at: Date.now() });

  return reply;
}

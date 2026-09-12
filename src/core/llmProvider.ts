import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ChatMessage } from "./conversationStore";

// One SDK client per (provider, apiKey) pair, reused across requests/tenants
// instead of constructing a fresh client on every message.
const anthropicClients = new Map<string, Anthropic>();
const openaiClients = new Map<string, OpenAI>();

function getAnthropic(apiKey: string): Anthropic {
  let client = anthropicClients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    anthropicClients.set(apiKey, client);
  }
  return client;
}

function getOpenAI(apiKey: string): OpenAI {
  let client = openaiClients.get(apiKey);
  if (!client) {
    client = new OpenAI({ apiKey });
    openaiClients.set(apiKey, client);
  }
  return client;
}

export interface LLMConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
}

/**
 * Calls whichever LLM provider/credentials this tenant is configured with
 * and returns the plain-text reply.
 */
export async function callLLM(
  llm: LLMConfig,
  system: string,
  history: ChatMessage[],
  message: string
): Promise<string> {
  if (llm.provider === "openai") {
    const openai = getOpenAI(llm.apiKey);
    const completion = await openai.chat.completions.create({
      model: llm.model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() || "Sorry, I couldn't come up with a reply just now.";
  }

  const anthropic = getAnthropic(llm.apiKey);
  const response = await anthropic.messages.create({
    model: llm.model,
    max_tokens: 2048,
    system,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text.trim() : "Sorry, I couldn't come up with a reply just now.";
}

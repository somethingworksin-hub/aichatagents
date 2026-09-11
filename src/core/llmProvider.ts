import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config";
import { ChatMessage } from "./conversationStore";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: config.anthropic.apiKey });
  return anthropicClient;
}

function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  return openaiClient;
}

/**
 * Calls whichever LLM provider is configured (AI_PROVIDER=anthropic|openai)
 * and returns the plain-text reply. Both branches take the same shape of
 * input so the rest of the app never needs to know which provider is active.
 */
export async function callLLM(system: string, history: ChatMessage[], message: string): Promise<string> {
  if (config.ai.provider === "openai") {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: config.openai.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() || "Sorry, I couldn't come up with a reply just now.";
  }

  const anthropic = getAnthropic();
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
  return textBlock && "text" in textBlock ? textBlock.text.trim() : "Sorry, I couldn't come up with a reply just now.";
}

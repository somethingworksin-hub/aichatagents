export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  at: number;
}

interface Conversation {
  messages: ChatMessage[];
  updatedAt: number;
}

const MAX_TURNS = 20;
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours of idle time before a thread resets

/**
 * In-memory per-channel conversation memory, keyed by "<channel>:<userId>".
 * Swap this out for Redis/Postgres if you need it to survive restarts
 * or run across multiple server instances.
 */
class ConversationStore {
  private conversations = new Map<string, Conversation>();

  private key(channel: string, userId: string): string {
    return `${channel}:${userId}`;
  }

  getHistory(channel: string, userId: string): ChatMessage[] {
    const key = this.key(channel, userId);
    const convo = this.conversations.get(key);
    if (!convo) return [];
    if (Date.now() - convo.updatedAt > TTL_MS) {
      this.conversations.delete(key);
      return [];
    }
    return convo.messages;
  }

  append(channel: string, userId: string, message: ChatMessage): void {
    const key = this.key(channel, userId);
    const convo = this.conversations.get(key) ?? { messages: [], updatedAt: Date.now() };
    convo.messages.push(message);
    if (convo.messages.length > MAX_TURNS * 2) {
      convo.messages = convo.messages.slice(-MAX_TURNS * 2);
    }
    convo.updatedAt = Date.now();
    this.conversations.set(key, convo);
  }

  reset(channel: string, userId: string): void {
    this.conversations.delete(this.key(channel, userId));
  }
}

export const conversationStore = new ConversationStore();

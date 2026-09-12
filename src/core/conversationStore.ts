import { db } from "../firebaseAdmin";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  at: number;
}

const MAX_TURNS = 20;

function threadRef(tenantId: string, channel: string, userId: string) {
  // Firestore doc ids can't contain "/", which channel user ids sometimes do
  // (e.g. email addresses don't, but be defensive for anything that might).
  const safeUserId = encodeURIComponent(userId);
  return db
    .collection("tenants")
    .doc(tenantId)
    .collection("conversations")
    .doc(`${channel}_${safeUserId}`);
}

/**
 * Per-tenant, per-channel, per-user conversation memory, persisted in
 * Firestore so it survives Cloud Run cold starts/restarts and is shared
 * across instances. Each thread document stores its own trimmed message
 * array (simplest structure for a chat-sized history; move to a messages
 * subcollection if you need to keep unbounded history per thread later).
 */
export async function getHistory(tenantId: string, channel: string, userId: string): Promise<ChatMessage[]> {
  const snap = await threadRef(tenantId, channel, userId).get();
  if (!snap.exists) return [];
  const data = snap.data();
  return (data?.messages as ChatMessage[]) ?? [];
}

export async function appendMessages(
  tenantId: string,
  channel: string,
  userId: string,
  newMessages: ChatMessage[]
): Promise<void> {
  const ref = threadRef(tenantId, channel, userId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = (snap.exists ? (snap.data()?.messages as ChatMessage[]) : []) ?? [];
    let messages = [...existing, ...newMessages];
    if (messages.length > MAX_TURNS * 2) {
      messages = messages.slice(-MAX_TURNS * 2);
    }
    tx.set(ref, { messages, updatedAt: Date.now() }, { merge: true });
  });
}

export async function resetHistory(tenantId: string, channel: string, userId: string): Promise<void> {
  await threadRef(tenantId, channel, userId).delete();
}

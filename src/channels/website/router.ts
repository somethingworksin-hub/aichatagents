import { Router } from "express";
import crypto from "crypto";
import { generateReply } from "../../core/chatbot";

export const websiteRouter = Router();

/**
 * POST /api/chat/website
 * body: { sessionId?: string, message: string, pageUrl?: string }
 * Returns: { sessionId, reply }
 *
 * sessionId ties messages to the same conversation memory. If the caller
 * doesn't have one yet (first message), the server mints one and returns it.
 */
websiteRouter.post("/api/chat/website", async (req, res) => {
  try {
    const { message, pageUrl } = req.body ?? {};
    let { sessionId } = req.body ?? {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    if (!sessionId || typeof sessionId !== "string") {
      sessionId = crypto.randomUUID();
    }

    const reply = await generateReply({
      channel: "website",
      userId: sessionId,
      message,
      extraSystemContext: pageUrl ? `The visitor is currently on this page: ${pageUrl}` : undefined,
    });

    res.json({ sessionId, reply });
  } catch (err) {
    console.error("[website] error generating reply", err);
    res.status(500).json({ error: "Something went wrong generating a reply." });
  }
});

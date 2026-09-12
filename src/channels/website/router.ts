import { Router } from "express";
import crypto from "crypto";
import { generateReply } from "../../core/chatbot";
import { findTenantByWebsiteSiteKey } from "../../core/tenant";

export const websiteRouter = Router();

/**
 * POST /api/chat/website
 * body: { siteKey: string, sessionId?: string, message: string, pageUrl?: string }
 * Returns: { sessionId, reply }
 *
 * siteKey identifies which tenant this widget belongs to (see
 * Tenant.website.siteKey) — the widget snippet embeds it. sessionId ties
 * messages to the same conversation memory; if the caller doesn't have one
 * yet (first message), the server mints one and returns it.
 */
websiteRouter.post("/api/chat/website", async (req, res) => {
  try {
    const { message, pageUrl, siteKey } = req.body ?? {};
    let { sessionId } = req.body ?? {};

    if (!siteKey || typeof siteKey !== "string") {
      return res.status(400).json({ error: "siteKey is required" });
    }
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    if (!sessionId || typeof sessionId !== "string") {
      sessionId = crypto.randomUUID();
    }

    const tenant = await findTenantByWebsiteSiteKey(siteKey);
    if (!tenant) {
      return res.status(404).json({ error: "Unknown siteKey." });
    }

    const reply = await generateReply({
      tenant,
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

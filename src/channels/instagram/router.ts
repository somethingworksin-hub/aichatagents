import { Router } from "express";
import { config } from "../../config";
import { generateReply } from "../../core/chatbot";
import { findTenantByInstagramAccountId } from "../../core/tenant";
import { sendMetaMessage, verifyMetaSignature } from "../meta/graphApi";

export const instagramRouter = Router();

// Instagram messaging rides on the same Graph API / webhook infrastructure as
// Messenger, just with object === "instagram" and IGSIDs instead of PSIDs.
// entry.id is the Instagram-scoped account id, which is how we know which
// tenant this message belongs to (see Tenant.instagram.instagramAccountId).

instagramRouter.get("/webhook/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.meta.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

instagramRouter.post("/webhook/instagram", async (req, res) => {
  const signature = req.header("x-hub-signature-256");
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (rawBody && !verifyMetaSignature(rawBody, signature)) {
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "instagram") return;

    for (const entry of body.entry ?? []) {
      const instagramAccountId = entry.id as string | undefined;
      if (!instagramAccountId) continue;

      const tenant = await findTenantByInstagramAccountId(instagramAccountId);
      if (!tenant?.instagram) {
        console.warn(`[instagram] no tenant configured for account ${instagramAccountId}`);
        continue;
      }

      for (const event of entry.messaging ?? []) {
        const senderId = event.sender?.id;
        const text = event.message?.text;
        if (!senderId || !text || event.message?.is_echo) continue;

        const reply = await generateReply({ tenant, channel: "instagram", userId: senderId, message: text });
        await sendMetaMessage(senderId, reply, tenant.instagram.pageAccessToken);
      }
    }
  } catch (err) {
    console.error("[instagram] error handling webhook", err);
  }
});

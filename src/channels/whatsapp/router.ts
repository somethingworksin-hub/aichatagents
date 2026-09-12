import { Router } from "express";
import fetch from "node-fetch";
import { config } from "../../config";
import { generateReply } from "../../core/chatbot";
import { findTenantByWhatsappPhoneNumberId } from "../../core/tenant";

export const whatsappRouter = Router();

async function sendWhatsAppMessage(to: string, text: string, phoneNumberId: string, accessToken: string): Promise<void> {
  const url = `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[whatsapp] send failed: ${res.status} ${body}`);
  }
}

whatsappRouter.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

whatsappRouter.post("/webhook/whatsapp", async (req, res) => {
  // Acknowledge immediately; WhatsApp expects a fast 200.
  res.sendStatus(200);

  try {
    const body = req.body;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const phoneNumberId = value.metadata?.phone_number_id as string | undefined;
        if (!phoneNumberId) continue;

        const tenant = await findTenantByWhatsappPhoneNumberId(phoneNumberId);
        if (!tenant?.whatsapp) {
          console.warn(`[whatsapp] no tenant configured for phone number id ${phoneNumberId}`);
          continue;
        }

        for (const message of value.messages ?? []) {
          const from = message.from; // sender's WhatsApp id (phone number)
          const text = message.text?.body;
          if (!from || !text) continue;

          const reply = await generateReply({ tenant, channel: "whatsapp", userId: from, message: text });
          await sendWhatsAppMessage(from, reply, phoneNumberId, tenant.whatsapp.accessToken);
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp] error handling webhook", err);
  }
});

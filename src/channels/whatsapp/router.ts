import { Router } from "express";
import fetch from "node-fetch";
import { config } from "../../config";
import { generateReply } from "../../core/chatbot";

export const whatsappRouter = Router();

async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const url = `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
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
        for (const message of value.messages ?? []) {
          const from = message.from; // sender's WhatsApp id (phone number)
          const text = message.text?.body;
          if (!from || !text) continue;

          const reply = await generateReply({ channel: "whatsapp", userId: from, message: text });
          await sendWhatsAppMessage(from, reply);
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp] error handling webhook", err);
  }
});

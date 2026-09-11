import { Router } from "express";
import { config } from "../../config";
import { generateReply } from "../../core/chatbot";
import { sendMetaMessage, verifyMetaSignature } from "../meta/graphApi";

export const facebookRouter = Router();

// Step 1: Meta calls this once when you register the webhook in the App dashboard.
facebookRouter.get("/webhook/facebook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.meta.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Step 2: Meta POSTs every Page message event here.
facebookRouter.post("/webhook/facebook", async (req, res) => {
  const signature = req.header("x-hub-signature-256");
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (rawBody && !verifyMetaSignature(rawBody, signature)) {
    return res.sendStatus(403);
  }

  // Acknowledge immediately; Meta requires a fast 200 or it will retry/backoff.
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        const senderId = event.sender?.id;
        const text = event.message?.text;
        if (!senderId || !text || event.message?.is_echo) continue;

        const reply = await generateReply({ channel: "facebook", userId: senderId, message: text });
        await sendMetaMessage(senderId, reply);
      }
    }
  } catch (err) {
    console.error("[facebook] error handling webhook", err);
  }
});

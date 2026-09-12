import { Router } from "express";
import { config } from "../../config";
import { getAuthUrl, exchangeCodeForToken } from "./oauth";
import { processUnreadMessages } from "./service";

export const gmailRouter = Router();

// Visit this URL in a browser once to grant the bot access to the Gmail inbox
// it should monitor and reply from.
gmailRouter.get("/gmail/auth", (_req, res) => {
  res.redirect(getAuthUrl());
});

gmailRouter.get("/gmail/oauth2callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).send("Missing ?code from Google's redirect.");
  }
  try {
    await exchangeCodeForToken(code);
    res.send("Gmail account connected. You can close this tab. Start (or restart) the poller to begin auto-replying.");
  } catch (err) {
    console.error("[gmail] oauth exchange failed", err);
    res.status(500).send("Failed to complete Gmail authorization. Check server logs.");
  }
});

/**
 * Trigger one poll cycle over HTTP, for hosts where a long-running
 * `npm run gmail:poll` process isn't practical (e.g. Cloud Run, which scales
 * services to zero when idle). Point a Cloud Scheduler job (or any cron) at
 * this URL every few minutes, with the shared secret as a query param or
 * `x-cron-secret` header.
 */
gmailRouter.post("/gmail/poll", async (req, res) => {
  if (!config.gmail.cronSecret) {
    return res.status(503).json({ error: "GMAIL_CRON_SECRET is not configured on this server." });
  }
  const provided = (req.header("x-cron-secret") || req.query.secret) as string | undefined;
  if (provided !== config.gmail.cronSecret) {
    return res.sendStatus(403);
  }

  try {
    await processUnreadMessages();
    res.json({ ok: true });
  } catch (err) {
    console.error("[gmail] /gmail/poll failed", err);
    res.status(500).json({ error: "Poll failed. Check server logs." });
  }
});

import { Router } from "express";
import { getAuthUrl, exchangeCodeForToken } from "./oauth";

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

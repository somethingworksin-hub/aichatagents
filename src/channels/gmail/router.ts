import { Router } from "express";
import { config } from "../../config";
import { getAuthUrl, exchangeCodeForToken } from "./oauth";
import { processUnreadMessagesForTenant, processUnreadMessagesForAllTenants } from "./service";
import { getTenant } from "../../core/tenant";

export const gmailRouter = Router();

// Visit this URL (as the tenant/client) to grant the bot access to the
// Gmail inbox it should monitor and reply from on their behalf.
gmailRouter.get("/gmail/auth", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) {
    return res.status(400).send("Missing ?tenantId= — which tenant is this Gmail account being connected for?");
  }
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return res.status(404).send(`No tenant found with id ${tenantId}.`);
    }
    res.redirect(getAuthUrl(tenantId));
  } catch (err) {
    console.error("[gmail] /gmail/auth failed", err);
    res.status(500).send("Something went wrong looking up that tenant. Check server logs.");
  }
});

gmailRouter.get("/gmail/oauth2callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const tenantId = req.query.state as string | undefined;
  if (!code || !tenantId) {
    return res.status(400).send("Missing ?code or state from Google's redirect.");
  }
  try {
    const address = await exchangeCodeForToken(tenantId, code);
    res.send(`Gmail account (${address}) connected for tenant ${tenantId}. You can close this tab.`);
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
 * `x-cron-secret` header. Pass ?tenantId= to poll just one tenant, or omit
 * it to poll every tenant that has Gmail connected.
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
    const tenantId = req.query.tenantId as string | undefined;
    if (tenantId) {
      const result = await processUnreadMessagesForTenant(tenantId);
      res.json({ ok: true, tenantId, ...result });
    } else {
      await processUnreadMessagesForAllTenants();
      res.json({ ok: true, polledAllTenants: true });
    }
  } catch (err) {
    console.error("[gmail] /gmail/poll failed", err);
    res.status(500).json({ error: "Poll failed. Check server logs." });
  }
});

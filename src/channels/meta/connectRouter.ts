import { Router } from "express";
import { config } from "../../config";
import { getTenant, updateTenant } from "../../core/tenant";
import { FieldValue } from "../../firebaseAdmin";
import { getFacebookLoginUrl, exchangeCodeForUserToken, exchangeForLongLivedToken, listManagedPages } from "./oauth";

export const connectRouter = Router();

function redirectUriFor(req: any): string {
  return `${req.protocol}://${req.get("host")}/connect/facebook/callback`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:-apple-system,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center;color:#1a1d21}
  h1{font-size:18px}p{color:#6b7280;font-size:14px}
  a.btn{display:block;padding:12px;margin:8px 0;border:1px solid #e3e6ea;border-radius:8px;text-decoration:none;color:#1a1d21;font-weight:600}
  a.btn:hover{background:#f5f6f8}</style></head><body>${body}</body></html>`;
}

/**
 * Sends the tenant's authorizing Facebook user through Meta's OAuth consent
 * screen ("Connect Facebook & Instagram" in the dashboard), instead of you
 * pasting Page IDs/tokens in manually. Requires META_APP_ID/META_APP_SECRET
 * to belong to a Meta App with the Facebook Login product added and this
 * server's /connect/facebook/callback URL registered as a Valid OAuth
 * Redirect URI (see README).
 */
connectRouter.get("/connect/facebook", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) return res.status(400).send("Missing ?tenantId=");
  if (!config.meta.appId) {
    return res.status(503).send(page("Not configured", "<h1>Not configured</h1><p>META_APP_ID isn't set on this server.</p>"));
  }
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) return res.status(404).send("No tenant found with that id.");

    res.redirect(getFacebookLoginUrl(tenantId, redirectUriFor(req)));
  } catch (err) {
    console.error("[connect/facebook] failed", err);
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Check server logs.</p>"));
  }
});

connectRouter.get("/connect/facebook/callback", async (req, res) => {
  const tenantId = req.query.state as string | undefined;
  const code = req.query.code as string | undefined;

  if (req.query.error) {
    return res.send(
      page("Cancelled", `<h1>Connection cancelled</h1><p>${escapeHtml((req.query.error_description as string) || "You cancelled the request.")}</p>`)
    );
  }
  if (!tenantId || !code) {
    return res.status(400).send("Missing code or state from Facebook's redirect.");
  }

  try {
    const shortLived = await exchangeCodeForUserToken(code, redirectUriFor(req));
    const longLived = await exchangeForLongLivedToken(shortLived);
    const pages = await listManagedPages(longLived);

    if (pages.length === 0) {
      return res.send(
        page(
          "No Pages found",
          "<h1>No Facebook Pages found</h1><p>The account you logged in with doesn't manage any Facebook Pages. Log in as a Page admin and try again.</p>"
        )
      );
    }

    if (pages.length === 1) {
      await savePage(tenantId, pages[0]);
      return res.send(successPage(pages[0].name, !!pages[0].instagramAccountId));
    }

    // Multiple Pages — store them temporarily and let the user pick.
    await updateTenant(tenantId, { pendingFacebookPages: pages });
    const links = pages
      .map((p) => `<a class="btn" href="/connect/facebook/select?tenantId=${encodeURIComponent(tenantId)}&pageId=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}${p.instagramAccountId ? " (+ Instagram)" : ""}</a>`)
      .join("");
    res.send(page("Choose a Page", `<h1>Which Page should this agent use?</h1><p>Your account manages more than one Facebook Page.</p>${links}`));
  } catch (err: any) {
    console.error("[connect/facebook] callback failed", err);
    res.status(500).send(page("Something went wrong", `<h1>Connection failed</h1><p>${escapeHtml(err?.message || "Unknown error")}</p>`));
  }
});

connectRouter.get("/connect/facebook/select", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const pageId = req.query.pageId as string | undefined;
  if (!tenantId || !pageId) return res.status(400).send("Missing tenantId or pageId.");

  try {
    const tenant = await getTenant(tenantId);
    const chosen = tenant?.pendingFacebookPages?.find((p) => p.id === pageId);
    if (!chosen) {
      return res.status(404).send(page("Not found", "<h1>That selection expired</h1><p>Please reconnect from the dashboard.</p>"));
    }

    await savePage(tenantId, chosen);
    await updateTenant(tenantId, { pendingFacebookPages: FieldValue.delete() as any });
    res.send(successPage(chosen.name, !!chosen.instagramAccountId));
  } catch (err) {
    console.error("[connect/facebook/select] failed", err);
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Check server logs.</p>"));
  }
});

async function savePage(
  tenantId: string,
  p: { id: string; name: string; accessToken: string; instagramAccountId?: string }
): Promise<void> {
  const patch: any = { facebook: { pageId: p.id, pageAccessToken: p.accessToken } };
  if (p.instagramAccountId) {
    patch.instagram = { instagramAccountId: p.instagramAccountId, pageAccessToken: p.accessToken };
  }
  await updateTenant(tenantId, patch);
}

function successPage(pageName: string, hasInstagram: boolean): string {
  return page(
    "Connected",
    `<h1>Connected to ${escapeHtml(pageName)}</h1><p>Facebook Messenger${hasInstagram ? " and Instagram DMs are" : " is"} now connected for this agent. You can close this tab.</p>`
  );
}

function escapeHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

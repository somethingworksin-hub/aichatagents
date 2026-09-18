import { Router } from "express";
import { config } from "../../config";
import { getTenant, updateTenant } from "../../core/tenant";
import { FieldValue } from "../../firebaseAdmin";
import { getFacebookLoginUrl, exchangeCodeForUserToken, exchangeForLongLivedToken, listManagedPages } from "./oauth";
import { getInstagramLoginUrl, exchangeCodeForShortLivedToken, exchangeForLongLivedInstagramToken, getInstagramProfile } from "./instagramOauth";

export const connectRouter = Router();

type ConnectChannel = "facebook" | "instagram" | "both";

function isConnectChannel(v: unknown): v is ConnectChannel {
  return v === "facebook" || v === "instagram" || v === "both";
}

// Both Facebook Messenger and Instagram DMs go through the same Meta Login
// grant (Instagram Business messaging is only reachable via a linked
// Facebook Page), so there's one OAuth flow underneath — but the dashboard
// shows separate "Connect Facebook" / "Connect Instagram" buttons, each
// saving only its own channel's data. `channel` rides in `state` alongside
// the tenant id (Firestore auto-ids never contain ":", so splitting on the
// last one is safe).
function encodeState(tenantId: string, channel: ConnectChannel): string {
  return `${tenantId}:${channel}`;
}
function decodeState(state: string | undefined): { tenantId: string; channel: ConnectChannel } | null {
  if (!state) return null;
  const i = state.lastIndexOf(":");
  if (i < 0) return null;
  const tenantId = state.slice(0, i);
  const channel = state.slice(i + 1);
  if (!tenantId || !isConnectChannel(channel)) return null;
  return { tenantId, channel };
}

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

function channelLabel(channel: ConnectChannel): string {
  return channel === "facebook" ? "Facebook Messenger" : channel === "instagram" ? "Instagram DMs" : "Facebook Messenger & Instagram DMs";
}

/**
 * Sends the tenant's authorizing Facebook user through Meta's OAuth consent
 * screen — "Connect Facebook" / "Connect Instagram" in the dashboard,
 * separate buttons that each only save their own channel (pass
 * ?channel=facebook or ?channel=instagram; omit/​"both" saves whichever
 * applies from a single click). Requires META_APP_ID/META_APP_SECRET to
 * belong to a Meta App with the Facebook Login product added and this
 * server's /connect/facebook/callback URL registered as a Valid OAuth
 * Redirect URI (see README).
 */
connectRouter.get("/connect/facebook", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const channel = isConnectChannel(req.query.channel) ? (req.query.channel as ConnectChannel) : "both";
  if (!tenantId) return res.status(400).send("Missing ?tenantId=");
  if (!config.meta.appId) {
    return res.status(503).send(page("Not configured", "<h1>Not configured</h1><p>META_APP_ID isn't set on this server.</p>"));
  }
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) return res.status(404).send("No tenant found with that id.");

    res.redirect(getFacebookLoginUrl(encodeState(tenantId, channel), redirectUriFor(req)));
  } catch (err) {
    console.error("[connect/facebook] failed", err);
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Check server logs.</p>"));
  }
});

connectRouter.get("/connect/facebook/callback", async (req, res) => {
  const decoded = decodeState(req.query.state as string | undefined);
  const code = req.query.code as string | undefined;

  if (req.query.error) {
    return res.send(
      page("Cancelled", `<h1>Connection cancelled</h1><p>${escapeHtml((req.query.error_description as string) || "You cancelled the request.")}</p>`)
    );
  }
  if (!decoded || !code) {
    return res.status(400).send("Missing code or state from Facebook's redirect.");
  }
  const { tenantId, channel } = decoded;

  try {
    const shortLived = await exchangeCodeForUserToken(code, redirectUriFor(req));
    const longLived = await exchangeForLongLivedToken(shortLived);
    const pages = await listManagedPages(longLived);

    if (channel === "instagram") {
      const withInstagram = pages.filter((p) => p.instagramAccountId);
      if (withInstagram.length === 0) {
        return res.send(
          page(
            "No Instagram account found",
            "<h1>No linked Instagram account found</h1><p>None of your Facebook Pages have a linked Instagram Business/Professional account. Link one in the Meta Business Suite and try again.</p>"
          )
        );
      }
      if (withInstagram.length === 1) {
        await saveChannel(tenantId, "instagram", withInstagram[0]);
        return res.send(successPage("instagram", withInstagram[0].instagramUsername || withInstagram[0].name));
      }
      return sendPagePicker(res, tenantId, channel, withInstagram);
    }

    if (pages.length === 0) {
      return res.send(
        page(
          "No Pages found",
          "<h1>No Facebook Pages found</h1><p>The account you logged in with doesn't manage any Facebook Pages. Log in as a Page admin and try again.</p>"
        )
      );
    }

    if (pages.length === 1) {
      await saveChannel(tenantId, channel, pages[0]);
      return res.send(successPage(channel, pages[0].name));
    }

    return sendPagePicker(res, tenantId, channel, pages);
  } catch (err: any) {
    console.error("[connect/facebook] callback failed", err);
    res.status(500).send(page("Something went wrong", `<h1>Connection failed</h1><p>${escapeHtml(err?.message || "Unknown error")}</p>`));
  }
});

async function sendPagePicker(
  res: any,
  tenantId: string,
  channel: ConnectChannel,
  pages: { id: string; name: string; instagramAccountId?: string; instagramUsername?: string }[]
) {
  await updateTenant(tenantId, { pendingFacebookPages: pages as any });
  const links = pages
    .map((p) => {
      const label = channel === "instagram" ? `@${p.instagramUsername || "?"} (via ${escapeHtml(p.name)})` : escapeHtml(p.name) + (p.instagramAccountId ? " (+ Instagram)" : "");
      return `<a class="btn" href="/connect/facebook/select?tenantId=${encodeURIComponent(tenantId)}&pageId=${encodeURIComponent(p.id)}&channel=${channel}">${label}</a>`;
    })
    .join("");
  res.send(page("Choose a Page", `<h1>Which Page should this agent use?</h1><p>Your account manages more than one Facebook Page.</p>${links}`));
}

connectRouter.get("/connect/facebook/select", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const pageId = req.query.pageId as string | undefined;
  const channel = isConnectChannel(req.query.channel) ? (req.query.channel as ConnectChannel) : "both";
  if (!tenantId || !pageId) return res.status(400).send("Missing tenantId or pageId.");

  try {
    const tenant = await getTenant(tenantId);
    const chosen = tenant?.pendingFacebookPages?.find((p) => p.id === pageId);
    if (!chosen) {
      return res.status(404).send(page("Not found", "<h1>That selection expired</h1><p>Please reconnect from the dashboard.</p>"));
    }

    await saveChannel(tenantId, channel, chosen);
    await updateTenant(tenantId, { pendingFacebookPages: FieldValue.delete() as any });
    res.send(successPage(channel, channel === "instagram" ? chosen.instagramUsername || chosen.name : chosen.name));
  } catch (err) {
    console.error("[connect/facebook/select] failed", err);
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Check server logs.</p>"));
  }
});

function instagramRedirectUriFor(req: any): string {
  return `${req.protocol}://${req.get("host")}/connect/instagram/callback`;
}

/**
 * Native Instagram Login — instagram.com's own login screen, rather than
 * Facebook's (see /connect/facebook?channel=instagram for that route).
 * Requires INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET, from the Meta App's
 * "Instagram API setup with Instagram Login" screen (separate from the
 * Facebook Login App ID/Secret), and this server's
 * /connect/instagram/callback registered as a Valid OAuth Redirect URI
 * there (see README).
 */
connectRouter.get("/connect/instagram", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) return res.status(400).send("Missing ?tenantId=");
  if (!config.instagramLogin.appId) {
    return res.status(503).send(page("Not configured", "<h1>Not configured</h1><p>INSTAGRAM_APP_ID isn't set on this server.</p>"));
  }
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) return res.status(404).send("No tenant found with that id.");

    res.redirect(getInstagramLoginUrl(tenantId, instagramRedirectUriFor(req)));
  } catch (err) {
    console.error("[connect/instagram] failed", err);
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Check server logs.</p>"));
  }
});

connectRouter.get("/connect/instagram/callback", async (req, res) => {
  const tenantId = req.query.state as string | undefined;
  const code = req.query.code as string | undefined;

  if (req.query.error) {
    return res.send(
      page("Cancelled", `<h1>Connection cancelled</h1><p>${escapeHtml((req.query.error_description as string) || "You cancelled the request.")}</p>`)
    );
  }
  if (!tenantId || !code) {
    return res.status(400).send("Missing code or state from Instagram's redirect.");
  }

  try {
    const shortLived = await exchangeCodeForShortLivedToken(code, instagramRedirectUriFor(req));
    const longLivedToken = await exchangeForLongLivedInstagramToken(shortLived.access_token);
    const profile = await getInstagramProfile(longLivedToken);

    await updateTenant(tenantId, {
      instagram: { instagramAccountId: profile.userId, pageAccessToken: longLivedToken, authMethod: "instagram" },
    });

    res.send(
      page(
        "Connected",
        `<h1>Connected to @${escapeHtml(profile.username)}</h1><p>Instagram DMs are now connected for this agent. You can close this tab.</p>`
      )
    );
  } catch (err: any) {
    console.error("[connect/instagram] callback failed", err);
    res.status(500).send(page("Something went wrong", `<h1>Connection failed</h1><p>${escapeHtml(err?.message || "Unknown error")}</p>`));
  }
});

async function saveChannel(
  tenantId: string,
  channel: ConnectChannel,
  p: { id: string; name: string; accessToken: string; instagramAccountId?: string }
): Promise<void> {
  const patch: any = {};
  if (channel === "facebook" || channel === "both") {
    patch.facebook = { pageId: p.id, pageAccessToken: p.accessToken };
  }
  if ((channel === "instagram" || channel === "both") && p.instagramAccountId) {
    patch.instagram = { instagramAccountId: p.instagramAccountId, pageAccessToken: p.accessToken };
  }
  await updateTenant(tenantId, patch);
}

function successPage(channel: ConnectChannel, name: string): string {
  return page("Connected", `<h1>Connected${channel === "instagram" ? " to " + escapeHtml(name) : " " + escapeHtml(name) + ""}</h1><p>${channelLabel(channel)} ${channel === "both" ? "are" : "is"} now connected for this agent. You can close this tab.</p>`);
}

function escapeHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

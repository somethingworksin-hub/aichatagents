import fetch from "node-fetch";
import { config } from "../../config";

// "Instagram API with Instagram Login" — a separate OAuth surface from
// Facebook Login, using instagram.com's own login screen. The account
// authorizing just needs to be an Instagram Professional (Business or
// Creator) account; no Facebook Page is involved in the login itself.
const INSTAGRAM_LOGIN_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"].join(",");

export function getInstagramLoginUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    force_reauth: "true",
    client_id: config.instagramLogin.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: INSTAGRAM_LOGIN_SCOPES,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

interface ShortLivedTokenResponse {
  access_token: string;
  user_id: string | number;
}

/** Exchanges the ?code= for a short-lived (~1hr) Instagram user access token. */
export async function exchangeCodeForShortLivedToken(code: string, redirectUri: string): Promise<ShortLivedTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.instagramLogin.appId,
    client_secret: config.instagramLogin.appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(data?.error_message || data?.error?.message || `Instagram token exchange failed (${res.status})`);
  }
  // Meta's docs show the fields directly on the response; some accounts see
  // them nested under `data[0]` — handle both.
  const payload = Array.isArray(data?.data) ? data.data[0] : data;
  return { access_token: payload.access_token, user_id: payload.user_id };
}

/** Upgrades a short-lived token to a long-lived one (~60 days). */
export async function exchangeForLongLivedInstagramToken(shortLivedToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: config.instagramLogin.appSecret,
    access_token: shortLivedToken,
  });
  const res = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`);
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(data?.error?.message || `Instagram long-lived token exchange failed (${res.status})`);
  }
  return data.access_token;
}

export interface InstagramProfile {
  userId: string;
  username: string;
}

export async function getInstagramProfile(accessToken: string): Promise<InstagramProfile> {
  const params = new URLSearchParams({ fields: "user_id,username", access_token: accessToken });
  const res = await fetch(`https://graph.instagram.com/${config.meta.graphApiVersion}/me?${params.toString()}`);
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(data?.error?.message || `Failed to fetch Instagram profile (${res.status})`);
  }
  return { userId: String(data.user_id ?? data.id), username: data.username };
}

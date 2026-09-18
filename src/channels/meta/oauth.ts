import fetch from "node-fetch";
import { config } from "../../config";

const GRAPH_BASE = `https://graph.facebook.com/${config.meta.graphApiVersion}`;

// pages_messaging/instagram_manage_messages require Meta App Review before
// they work for anyone other than your app's own admins/developers/testers
// (added under App Roles in the Meta App dashboard) — see README.
export const FACEBOOK_LOGIN_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
].join(",");

export function getFacebookLoginUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_LOGIN_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/${config.meta.graphApiVersion}/dialog/oauth?${params.toString()}`;
}

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${GRAPH_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(data?.error?.message || `Graph API request failed (${res.status})`);
  }
  return data as T;
}

export async function exchangeCodeForUserToken(code: string, redirectUri: string): Promise<string> {
  const data = await graphGet<GraphTokenResponse>("/oauth/access_token", {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: redirectUri,
    code,
  });
  return data.access_token;
}

/** Short-lived user tokens expire in ~1-2 hours; exchange for a ~60-day one. */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const data = await graphGet<GraphTokenResponse>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  return data.access_token;
}

export interface ManagedPage {
  id: string;
  name: string;
  accessToken: string;
  instagramAccountId?: string;
  instagramUsername?: string;
}

interface GraphPagesResponse {
  data: {
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string; username?: string };
  }[];
}

/**
 * Lists every Facebook Page the authorizing user manages, with each Page's
 * own (long-lived, since it inherits from a long-lived user token) access
 * token and linked Instagram Business account, if any.
 */
export async function listManagedPages(userAccessToken: string): Promise<ManagedPage[]> {
  const data = await graphGet<GraphPagesResponse>("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: userAccessToken,
  });
  return data.data.map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    instagramAccountId: p.instagram_business_account?.id,
    instagramUsername: p.instagram_business_account?.username,
  }));
}

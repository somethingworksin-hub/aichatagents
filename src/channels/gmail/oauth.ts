import { google } from "googleapis";
import { config } from "../../config";
import { getTenant, updateTenant } from "../../core/tenant";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

export function createOAuthClient() {
  return new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret, config.gmail.redirectUri);
}

// The `state` param round-trips through Google's OAuth flow untouched, so we
// use it to remember which tenant is authorizing (this is one shared Google
// OAuth client used across every tenant's own inbox).
export function getAuthUrl(tenantId: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state: tenantId,
  });
}

/**
 * Exchanges the OAuth code for tokens, fetches the authorized inbox's own
 * address, and stores both on the tenant's Firestore document.
 */
export async function exchangeCodeForToken(tenantId: string, code: string): Promise<string> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const address = (profile.data.emailAddress ?? "").toLowerCase();

  await updateTenant(tenantId, { gmail: { address, tokens } });
  return address;
}

export async function getAuthorizedClientForTenant(tenantId: string) {
  const tenant = await getTenant(tenantId);
  if (!tenant?.gmail?.tokens) {
    throw new Error(
      `Tenant ${tenantId} hasn't authorized Gmail yet. Visit /gmail/auth?tenantId=${tenantId} to connect it.`
    );
  }

  const client = createOAuthClient();
  client.setCredentials(tenant.gmail.tokens);

  client.on("tokens", (newTokens) => {
    const merged = { ...tenant.gmail!.tokens, ...newTokens };
    updateTenant(tenantId, { gmail: { ...tenant.gmail, tokens: merged } }).catch((err) =>
      console.error(`[gmail] failed to persist refreshed token for tenant ${tenantId}`, err)
    );
  });

  return client;
}

import { db, FieldValue } from "../firebaseAdmin";

export interface Tenant {
  id: string;
  name: string;
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;

  ai: {
    provider: "anthropic" | "openai";
    apiKey: string;
    model?: string;
  };

  bot: {
    name: string;
    persona: string;
  };

  // Public key the website widget sends to identify which tenant it belongs to.
  // Not a secret (it's visible in the page source), so it's just an opaque id.
  website?: {
    siteKey: string;
    allowedOrigins?: string[];
  };

  // One shared Meta app (META_VERIFY_TOKEN/META_APP_SECRET in env) is used
  // across every tenant; each tenant brings their own Page + access token.
  facebook?: {
    pageId: string;
    pageAccessToken: string;
  };

  instagram?: {
    instagramAccountId: string; // the id Meta's "instagram" webhook object reports in entry.id
    pageAccessToken: string;
    // "facebook" (default/legacy, absent): connected via Facebook Login — this
    // is a Page access token, sent through graph.facebook.com.
    // "instagram": connected via the native Instagram Login flow — this is an
    // Instagram user access token, sent through graph.instagram.com instead.
    authMethod?: "facebook" | "instagram";
  };

  // One shared WhatsApp app (WHATSAPP_VERIFY_TOKEN in env); each tenant
  // brings their own phone number + access token.
  whatsapp?: {
    phoneNumberId: string;
    accessToken: string;
  };

  // One shared Google OAuth client (GMAIL_CLIENT_ID/SECRET in env); each
  // tenant authorizes their own inbox and gets their own token set stored here.
  gmail?: {
    address?: string;
    // Whatever googleapis' OAuth2Client.getToken()/`tokens` event hands back
    // (access_token, refresh_token, expiry_date, etc.) — stored as-is.
    tokens?: Record<string, any>;
  };

  // Transient: set right after a "Connect Facebook" OAuth flow when the
  // authorizing user manages more than one Page, so they can be shown a
  // picker (see src/channels/meta/connectRouter.ts). Cleared once a page
  // is selected.
  pendingFacebookPages?: {
    id: string;
    name: string;
    accessToken: string;
    instagramAccountId?: string;
    instagramUsername?: string;
  }[];
}

const COLLECTION = "tenants";
const CACHE_TTL_MS = 30_000;

const byIdCache = new Map<string, { tenant: Tenant | null; expiresAt: number }>();

function docToTenant(doc: FirebaseFirestore.DocumentSnapshot): Tenant {
  return { id: doc.id, ...(doc.data() as Omit<Tenant, "id">) };
}

export async function createTenant(input: Omit<Tenant, "id" | "createdAt" | "updatedAt">): Promise<Tenant> {
  const ref = db.collection(COLLECTION).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({ ...input, createdAt: now, updatedAt: now });
  const snap = await ref.get();
  return docToTenant(snap);
}

export async function updateTenant(id: string, patch: Partial<Omit<Tenant, "id">>): Promise<Tenant> {
  const ref = db.collection(COLLECTION).doc(id);
  await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  byIdCache.delete(id);
  const snap = await ref.get();
  return docToTenant(snap);
}

export async function deleteTenant(id: string): Promise<void> {
  await db.collection(COLLECTION).doc(id).delete();
  byIdCache.delete(id);
}

export async function listTenants(): Promise<Tenant[]> {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map(docToTenant);
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const cached = byIdCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;

  const snap = await db.collection(COLLECTION).doc(id).get();
  const tenant = snap.exists ? docToTenant(snap) : null;
  byIdCache.set(id, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
  return tenant;
}

async function findOneWhere(field: string, value: string): Promise<Tenant | null> {
  if (!value) return null;
  const snap = await db.collection(COLLECTION).where(field, "==", value).limit(1).get();
  if (snap.empty) return null;
  const tenant = docToTenant(snap.docs[0]);
  byIdCache.set(tenant.id, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
  return tenant;
}

export function findTenantByWebsiteSiteKey(siteKey: string): Promise<Tenant | null> {
  return findOneWhere("website.siteKey", siteKey);
}

export function findTenantByFacebookPageId(pageId: string): Promise<Tenant | null> {
  return findOneWhere("facebook.pageId", pageId);
}

export function findTenantByInstagramAccountId(instagramAccountId: string): Promise<Tenant | null> {
  return findOneWhere("instagram.instagramAccountId", instagramAccountId);
}

export function findTenantByWhatsappPhoneNumberId(phoneNumberId: string): Promise<Tenant | null> {
  return findOneWhere("whatsapp.phoneNumberId", phoneNumberId);
}

export function findTenantByGmailAddress(address: string): Promise<Tenant | null> {
  return findOneWhere("gmail.address", address.toLowerCase());
}

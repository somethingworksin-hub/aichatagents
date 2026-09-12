import { gmail_v1, google } from "googleapis";
import { config } from "../../config";
import { generateReply } from "../../core/chatbot";
import { getTenant, listTenants, Tenant } from "../../core/tenant";
import { getAuthorizedClientForTenant } from "./oauth";

function decodeHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part);
    if (text) return text;
  }

  // Fall back to HTML with tags stripped, if that's all we got.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
}

function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match ? match[1] : headerValue).trim().toLowerCase();
}

function buildRawReply(opts: {
  to: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
}): string {
  const subject = opts.subject.toLowerCase().startsWith("re:") ? opts.subject : `Re: ${opts.subject}`;
  const lines = [
    `To: ${opts.to}`,
    `From: ${opts.from}`,
    `Subject: ${subject}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
    opts.references ? `References: ${opts.references}` : "",
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    opts.body,
  ].filter((line) => line !== undefined);

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Checks one tenant's inbox for unread messages, generates a reply for each
 * using their configured AI provider/persona, sends it, and marks the
 * message as read so it isn't processed twice.
 */
export async function processUnreadMessagesForTenant(tenantId: string): Promise<{ processed: number }> {
  const tenant = await getTenant(tenantId);
  if (!tenant?.gmail?.tokens) {
    throw new Error(`Tenant ${tenantId} hasn't authorized Gmail yet.`);
  }

  const auth = await getAuthorizedClientForTenant(tenantId);
  const gmail = google.gmail({ version: "v1", auth });

  const myEmail = (tenant.gmail.address ?? "").toLowerCase();

  const list = await gmail.users.messages.list({
    userId: "me",
    labelIds: [config.gmail.labelToWatch],
    q: "is:unread -in:chats",
    maxResults: 20,
  });

  let processed = 0;

  for (const meta of list.data.messages ?? []) {
    if (!meta.id) continue;

    const full = await gmail.users.messages.get({ userId: "me", id: meta.id, format: "full" });
    const headers = full.data.payload?.headers;

    const fromHeader = decodeHeader(headers, "From");
    const fromAddress = extractEmailAddress(fromHeader);
    const subject = decodeHeader(headers, "Subject") || "(no subject)";
    const messageId = decodeHeader(headers, "Message-Id");
    const references = [decodeHeader(headers, "References"), messageId].filter(Boolean).join(" ");
    const body = extractPlainText(full.data.payload) || full.data.snippet || "";

    if (!fromAddress || fromAddress === myEmail) {
      // Don't auto-reply to ourselves.
      await gmail.users.messages.modify({ userId: "me", id: meta.id, requestBody: { removeLabelIds: ["UNREAD"] } });
      continue;
    }

    try {
      const reply = await generateReply({
        tenant,
        channel: "gmail",
        userId: fromAddress,
        message: body,
        extraSystemContext: `Email subject: "${subject}"`,
      });

      const raw = buildRawReply({
        to: fromHeader || fromAddress,
        from: myEmail,
        subject,
        body: reply,
        inReplyTo: messageId,
        references,
      });

      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw, threadId: full.data.threadId ?? undefined },
      });

      await gmail.users.messages.modify({ userId: "me", id: meta.id, requestBody: { removeLabelIds: ["UNREAD"] } });
      console.log(`[gmail] tenant ${tenantId} replied to ${fromAddress} (subject: "${subject}")`);
      processed++;
    } catch (err) {
      console.error(`[gmail] tenant ${tenantId} failed to process message ${meta.id}`, err);
    }
  }

  return { processed };
}

/**
 * Polls every tenant that has connected Gmail. Used by the standalone
 * `npm run gmail:poll` worker and by POST /gmail/poll when called without a
 * specific tenantId.
 */
export async function processUnreadMessagesForAllTenants(): Promise<void> {
  const tenants = await listTenants();
  const withGmail = tenants.filter((t: Tenant) => t.gmail?.tokens);

  for (const tenant of withGmail) {
    try {
      await processUnreadMessagesForTenant(tenant.id);
    } catch (err) {
      console.error(`[gmail] poll failed for tenant ${tenant.id}`, err);
    }
  }
}

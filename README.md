# AI Chat Agents

A multi-tenant, Claude/GPT-powered chatbot platform across **website**, **Instagram**, **Facebook**, **WhatsApp**, and **Gmail**. Each client ("tenant") gets their own AI provider/key, persona, knowledge base, and channel credentials — all stored in Firestore — while sharing one deployed server and one codebase.

## Architecture

```
src/
  config.ts                 # shared/platform-level env config (Meta app, WhatsApp app, Google OAuth client, admin key)
  firebaseAdmin.ts           # Firestore client bootstrap
  core/
    tenant.ts                 # Tenant type + Firestore CRUD + resolver lookups
    chatbot.ts                # generateReply({ tenant, channel, userId, message }) — the shared reply engine
    llmProvider.ts             # calls Anthropic or OpenAI using a tenant's own key
    conversationStore.ts      # Firestore-backed per-tenant, per-channel, per-user history
    knowledgeBase.ts          # Firestore-backed per-tenant knowledge base (TF-IDF retrieval)
  channels/
    website/router.ts        # REST endpoint used by the embeddable widget (resolves tenant by siteKey)
    facebook/router.ts       # Messenger webhook (resolves tenant by Page ID)
    instagram/router.ts      # Instagram DM webhook (resolves tenant by IG account ID)
    whatsapp/router.ts       # WhatsApp Cloud API webhook (resolves tenant by phone number ID)
    gmail/                   # OAuth2 (per-tenant) + inbox poller + send-reply
    admin/router.ts          # secret-protected REST API to create/manage tenants + their knowledge base
  index.ts                   # Express server wiring every channel
public/
  widget.js                  # drop-in embeddable chat widget (takes a data-site-key)
  demo.html                  # example page hosting the widget
```

Every channel resolves an incoming message to a **Tenant** (by site key, Page ID, phone number ID, or Gmail address), then calls the same `generateReply({ tenant, channel, userId, message })` in `src/core/chatbot.ts`. Nothing in the core engine is tenant-specific — it just reads whatever's on the `Tenant` object. Add a tenant, and every channel already knows how to serve them.

## 1. One-time platform setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with the **shared, platform-level** settings (not tenant-specific — see below):
- `ADMIN_API_KEY` — any long random string; protects the tenant-management API
- `META_VERIFY_TOKEN` / `META_APP_SECRET` — one Meta app used across every tenant's Facebook/Instagram
- `WHATSAPP_VERIFY_TOKEN` — one WhatsApp app used across every tenant's phone number
- `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` — one Google OAuth client every tenant authorizes their own inbox against

You'll also need a Firestore database (see **Firestore setup** below) and, for local dev, Google credentials the Firebase Admin SDK can use:
```bash
gcloud auth application-default login
```

Then:
```bash
npm run dev
```

The server starts on `http://localhost:3000`. For webhooks (Facebook/Instagram/WhatsApp) Meta needs to reach your server over HTTPS — use a tunnel like `ngrok http 3000` during development, and use that HTTPS URL wherever "your server URL" is mentioned below.

## 2. Firestore setup

1. In the [Firebase Console](https://console.firebase.google.com), open your project → **Build → Firestore Database → Create database**. Any region/mode default is fine (Native mode).
2. Locally, `gcloud auth application-default login` (above) lets the Admin SDK reach it using your own Google account's permissions. On Cloud Run, no setup is needed — the service's default credentials just work. On Render/other non-GCP hosts, see **Deploying to Render** below.

## 3. Creating a tenant (a client)

There's no dashboard UI yet — tenants are created via the admin API. Every request needs an `x-admin-key: <ADMIN_API_KEY>` header.

```bash
curl -X POST http://localhost:3000/admin/tenants \
  -H "Content-Type: application/json" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{
    "name": "Acme Co",
    "ai": { "provider": "openai", "apiKey": "sk-xxxxx", "model": "gpt-4o-mini" },
    "bot": { "name": "Acme Assistant", "persona": "You are a friendly, concise support assistant for Acme Co." },
    "website": {}
  }'
```

The response includes the new tenant's `id` and (if you included a `website` block) a generated `website.siteKey`. Save both — you'll need `id` for every other admin call, and `siteKey` for the website widget snippet.

Other useful calls:
```bash
# List all tenants
curl http://localhost:3000/admin/tenants -H "x-admin-key: $ADMIN_API_KEY"

# Get one tenant
curl http://localhost:3000/admin/tenants/TENANT_ID -H "x-admin-key: $ADMIN_API_KEY"

# Update a tenant (partial — only send what's changing)
curl -X PATCH http://localhost:3000/admin/tenants/TENANT_ID \
  -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"bot": {"name": "New Name", "persona": "Updated persona text."}}'
```

To connect a channel for this tenant, `PATCH` in the relevant block (see each channel's section below for where the values come from):
```bash
curl -X PATCH http://localhost:3000/admin/tenants/TENANT_ID \
  -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"whatsapp": {"phoneNumberId": "1234567890", "accessToken": "EAAxxxxx"}}'
```

See `CLIENT_ONBOARDING.md` for the full checklist of onboarding a client end-to-end.

## 4. Website

1. Deploy the server somewhere reachable over HTTPS (or test locally).
2. Create the tenant with a `website` block (see above) to get a `siteKey`.
3. On any page of the client's site, add:
   ```html
   <script src="https://your-server.example.com/widget.js"
           data-api-base="https://your-server.example.com"
           data-site-key="THEIR_SITE_KEY"
           data-bot-name="Chat with us"></script>
   ```
4. Try it locally at `http://localhost:3000/demo.html?siteKey=THEIR_SITE_KEY`.

## 5. Facebook Messenger

The Meta app itself (`META_VERIFY_TOKEN`/`META_APP_SECRET`) is shared across all tenants and only needs setting up once, ever:

1. Create a Meta App at https://developers.facebook.com/apps (type: **Business**), add the **Messenger** product.
2. Copy the App Secret (App Settings → Basic) into `META_APP_SECRET`. Pick any random string for `META_VERIFY_TOKEN`.
3. Under Messenger → Settings → Webhooks, **Add Callback URL**: `https://your-server.example.com/webhook/facebook`, Verify Token = `META_VERIFY_TOKEN`. Subscribe to the `messages` field.

Per tenant, once the Meta app above exists:

1. Under Messenger → Settings, generate a **Page Access Token** for that client's Facebook Page, and subscribe their Page to the app.
2. Note the **Page ID** (found in their Page's About/Settings).
3. `PATCH` the tenant: `{"facebook": {"pageId": "...", "pageAccessToken": "..."}}`.
4. Send their Page a message on Messenger — it should reply automatically.

## 6. Instagram DMs

Rides on the same Meta app as Messenger, once a client's Instagram Professional/Business account is linked to their Facebook Page.

1. (Once) In your Meta App, add the **Instagram** product; under Webhooks subscribe the **Instagram** object to `messages` with Callback URL `https://your-server.example.com/webhook/instagram`, Verify Token = `META_VERIFY_TOKEN`.
2. Per tenant: connect their Page's linked IG account in the Meta App, note the **Instagram-scoped account ID** (this is what shows up as `entry.id` in webhook payloads — Meta's docs/Graph API Explorer can also surface it), and reuse their Page Access Token.
3. `PATCH` the tenant: `{"instagram": {"instagramAccountId": "...", "pageAccessToken": "..."}}`.
4. DM their connected Instagram account to test.

## 7. WhatsApp

The WhatsApp app itself (`WHATSAPP_VERIFY_TOKEN`) is shared; only set up once:

1. (Once) In your Meta App, add the **WhatsApp** product. Under Configuration → Webhook, set Callback URL `https://your-server.example.com/webhook/whatsapp`, Verify Token = `WHATSAPP_VERIFY_TOKEN`, subscribed to `messages`.

Per tenant:

1. From WhatsApp → API Setup for that client's number, grab their access token and **Phone number ID**.
2. `PATCH` the tenant: `{"whatsapp": {"phoneNumberId": "...", "accessToken": "..."}}`.
3. Send a WhatsApp message to their number to see the bot reply.

## 8. Gmail

Auto-replies to unread mail in an inbox a client authorizes. Uses OAuth2 (a real user grants access) since replying "as" their inbox needs delegated permission. One Google OAuth client (`GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`) is shared across every tenant.

1. (Once) In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Gmail API**, and create an **OAuth 2.0 Client ID** (type: Web application) with an authorized redirect URI matching `GMAIL_REDIRECT_URI`.
2. Per tenant: have them (or you, on their behalf) visit `https://your-server.example.com/gmail/auth?tenantId=TENANT_ID`, log into the Gmail/Workspace account to monitor, and grant access. This stores their tokens + address on the Tenant document automatically — no `PATCH` needed.
3. Trigger a poll:
   - **Locally / a host that keeps a process alive**: `npm run gmail:poll` (polls every tenant with Gmail connected, every `GMAIL_POLL_INTERVAL_MS`).
   - **Cloud Run / serverless**: `POST /gmail/poll` (see the Firebase deployment section below for wiring this to Cloud Scheduler). Pass `?tenantId=TENANT_ID` to poll just one tenant, or omit it to poll all of them.

For production, prefer [Gmail push notifications via Cloud Pub/Sub](https://developers.google.com/gmail/api/guides/push) over polling — the polling approach here is the simplest way to get started without provisioning Pub/Sub.

## 9. Feeding a tenant's knowledge base ("training" it on their data)

The bot doesn't get fine-tuned — instead it does retrieval: every incoming message is matched against that tenant's own documents, and the most relevant snippets are handed to the model as context before it replies.

```bash
# Add a document (splits into paragraph-sized chunks automatically)
curl -X POST http://localhost:3000/admin/tenants/TENANT_ID/knowledge \
  -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"source": "Refund Policy", "text": "We offer a full refund within 14 days...\n\nAfter 14 days, refunds are case-by-case..."}'

# See what's loaded
curl http://localhost:3000/admin/tenants/TENANT_ID/knowledge -H "x-admin-key: $ADMIN_API_KEY"

# Clear everything for this tenant (e.g. before re-uploading a revised doc set)
curl -X DELETE http://localhost:3000/admin/tenants/TENANT_ID/knowledge -H "x-admin-key: $ADMIN_API_KEY"
```

Separate distinct facts/topics in `text` with a blank line — retrieval works paragraph by paragraph, so one idea per paragraph gives better results than one giant wall of text. This works the same across every channel since they all share `generateReply()`. Retrieval is a lightweight TF-IDF match (`src/core/knowledgeBase.ts`) — enough for FAQs/docs in the tens-to-low-hundreds of pages per tenant. If a tenant outgrows that, swap in a real vector store behind the same `retrieveContext()` function.

## Customizing a tenant's bot

- `PATCH` their `bot.persona` / `bot.name` to change tone/instructions.
- Per-channel tweaks (e.g. shorter replies on SMS-like channels) apply to everyone and live in `channelNotes` inside `src/core/chatbot.ts`.
- To hand off to a human, have the model include a marker phrase in its reply and check for it in each channel's router before sending — the hook points are already there (`generateReply` return value in each router).

## Deploying to Firebase (Cloud Run + Hosting)

This is a stateful Express server (webhooks, OAuth callbacks), so it runs on **Cloud Run** rather than Cloud Functions — Cloud Run behaves like Render/any container host, just on Google's infrastructure. **Firebase Hosting** sits in front of it so you get a clean `https://your-project.web.app` URL, proxying everything through to Cloud Run. Firestore (the tenant database) lives in the same project, so Cloud Run's default credentials reach it with no extra setup.

### One-time setup

1. Install the CLIs (if you don't have them):
   ```bash
   npm install -g firebase-tools
   ```
   You'll also need the [gcloud CLI](https://cloud.google.com/sdk/docs/install).
2. Create a project at https://console.firebase.google.com (or reuse an existing one), enable Firestore (see **Firestore setup** above), then log in locally:
   ```bash
   firebase login
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. Put your project ID into `.firebaserc` (replace `your-firebase-project-id`), and into `firebase.json`'s `region` if you're not using `us-central1`.
4. Enable the APIs Cloud Run needs (one-time per project):
   ```bash
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com
   ```

### Deploy the server to Cloud Run

```bash
gcloud run deploy aichatagents \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars ADMIN_API_KEY=xxxxx,META_VERIFY_TOKEN=xxxxx,META_APP_SECRET=xxxxx,WHATSAPP_VERIFY_TOKEN=xxxxx,GMAIL_CLIENT_ID=xxxxx,GMAIL_CLIENT_SECRET=xxxxx,GMAIL_REDIRECT_URI=https://your-project.web.app/gmail/oauth2callback
```

Note these are all **shared/platform** values now — no AI keys or bot persona here, since those live per-tenant in Firestore via the admin API. `--source .` tells Cloud Build to use the repo's `Dockerfile` automatically. Re-run the same command any time you change code or env vars.

For secrets you don't want in shell history/CI logs, use [Secret Manager](https://cloud.google.com/run/docs/configuring/secrets) instead of `--set-env-vars`, or add them via the Cloud Run console under **Edit & Deploy New Revision → Variables & Secrets**.

### Put Firebase Hosting in front of it

```bash
firebase deploy --only hosting
```

That Hosting URL is your "server URL" everywhere in this README — webhook callback URLs, `GMAIL_REDIRECT_URI`, the widget's `data-api-base`. You can also skip Hosting and use the Cloud Run service URL directly.

### Gmail polling on Cloud Run

Cloud Run scales to zero when idle, so a long-running `npm run gmail:poll` loop won't reliably stay up. Use `POST /gmail/poll` (protected by `GMAIL_CRON_SECRET`) with **Cloud Scheduler** instead, polling every connected tenant:

```bash
gcloud scheduler jobs create http gmail-poll \
  --schedule="*/5 * * * *" \
  --uri="https://your-project.web.app/gmail/poll?secret=YOUR_GMAIL_CRON_SECRET" \
  --http-method=POST \
  --location=us-central1
```

Set `GMAIL_CRON_SECRET` in the Cloud Run service's env vars to the same value.

### Notes
- Cloud Run's free tier is generous for low-traffic bots; you pay per request/compute time rather than a flat monthly fee like Render.
- Per-tenant conversation history and knowledge base both live in Firestore, so they survive redeploys and scale-to-zero fine — nothing is written to local container disk anymore.

## Deploying to Render (alternative)

This repo includes a `render.yaml` blueprint. Render has no ambient GCP credentials the way Cloud Run does, so you'll need to hand Firestore a service account key directly:

1. Firebase Console → Project Settings → Service Accounts → **Generate new private key**, downloading a JSON file.
2. Push this repo to GitHub, then in Render: **New → Blueprint**, point it at this repo.
3. Fill in the env vars Render prompts for (marked `sync: false` in `render.yaml`), including `GOOGLE_APPLICATION_CREDENTIALS_JSON` — paste the **entire contents** of that service account JSON file as a single-line value.
4. Deploy. Render gives you a public URL like `https://aichatagents.onrender.com` — your "server URL" everywhere in this README.
5. After deploying, update `GMAIL_REDIRECT_URI` to match (both in Render's env vars *and* the Google OAuth client's authorized redirect URIs).

**Free tier notes:**
- Render's free web services spin down after inactivity and take ~30-60s to wake on the next request.
- The Gmail poller (`npm run gmail:poll`) needs to run continuously — add it as a second Render service (**Background Worker**, same repo, start command `npm run gmail:poll`).

## Deploying elsewhere

```bash
npm run build
npm start
```

Set `GOOGLE_APPLICATION_CREDENTIALS_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file) so the Firebase Admin SDK can reach Firestore. Run the Gmail poller (`npm run gmail:poll`) as a separate process/service if you're using that channel.

## What's next (not built yet)

This is the Firestore-backed multi-tenant *foundation* — data model, tenant resolution, and an admin API. Deliberately not included yet:
- A signup/login dashboard (tenants are currently managed via curl + `x-admin-key`)
- Billing/usage metering per tenant
- Per-tenant origin enforcement for the website widget (currently CORS is open; `siteKey` is the actual gate)

See the multi-tenant hour estimate discussed alongside this repo for scoping that follow-on work.

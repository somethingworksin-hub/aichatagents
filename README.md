# AI Chat Agents

One Claude-powered chatbot, deployed across your **website**, **Instagram**, **Facebook**, **WhatsApp**, and **Gmail** — sharing one core reply engine and one persona, with per-channel conversation memory.

## Architecture

```
src/
  config.ts                 # env-driven configuration
  core/
    chatbot.ts               # generateReply() — the shared Claude engine
    conversationStore.ts     # in-memory per-user, per-channel history
  channels/
    website/router.ts        # REST endpoint used by the embeddable widget
    facebook/router.ts       # Messenger webhook (Meta Graph API)
    instagram/router.ts      # Instagram DM webhook (Meta Graph API)
    whatsapp/router.ts       # WhatsApp Cloud API webhook
    gmail/                   # OAuth2 + inbox poller + send-reply
  index.ts                   # Express server wiring every channel
public/
  widget.js                  # drop-in embeddable chat widget
  demo.html                  # example page hosting the widget
```

Every channel funnels into the same `generateReply({ channel, userId, message })` in `src/core/chatbot.ts`, so you only maintain one prompt/persona and one model integration. Conversation memory is scoped per `channel:userId` so a conversation on Instagram doesn't leak into WhatsApp.

The in-memory conversation store resets on restart and doesn't share state across multiple server instances. For production, swap `conversationStore.ts` for Redis/Postgres.

## 1. Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `AI_PROVIDER` — `anthropic` (Claude) or `openai` (GPT). Only fill in the key for the one you pick.
  - `ANTHROPIC_API_KEY` — from https://console.anthropic.com
  - `OPENAI_API_KEY` — from https://platform.openai.com/api-keys
- `BOT_NAME` / `BOT_PERSONA` — your bot's identity and instructions

Then for local development:

```bash
npm run dev
```

The server starts on `http://localhost:3000`. For webhooks (Facebook/Instagram/WhatsApp) Meta needs to reach your server over HTTPS — use a tunnel like `ngrok http 3000` during development and use that HTTPS URL wherever "your server URL" is mentioned below.

## 2. Website

1. Deploy the server somewhere reachable over HTTPS.
2. On any page of your site, add:
   ```html
   <script src="https://your-server.example.com/widget.js"
           data-api-base="https://your-server.example.com"
           data-bot-name="Chat with us"></script>
   ```
3. That's it — the widget POSTs to `/api/chat/website` and renders replies. Try it locally at `http://localhost:3000/demo.html`.

## 3. Facebook Messenger

1. Create a Meta App at https://developers.facebook.com/apps (type: **Business**).
2. Add the **Messenger** product.
3. Under Messenger → Settings, generate a **Page Access Token** for the Facebook Page you want to connect. Put it in `META_PAGE_ACCESS_TOKEN`.
4. Copy the App Secret (App Settings → Basic) into `META_APP_SECRET`.
5. Pick any random string for `META_VERIFY_TOKEN` (you choose it, Meta just echoes it back during setup).
6. Under Messenger → Settings → Webhooks, click **Add Callback URL**:
   - Callback URL: `https://your-server.example.com/webhook/facebook`
   - Verify Token: same value as `META_VERIFY_TOKEN`
7. Subscribe the webhook to the `messages` field, and subscribe your Page to the app.
8. Send your Page a message on Messenger — it should reply automatically.

## 4. Instagram DMs

Instagram messaging rides on the same Meta Graph API as Messenger, once your Instagram Professional/Business account is linked to the Facebook Page above.

1. In your Meta App, add the **Instagram** product and connect the same Page's linked IG account.
2. Under Webhooks, subscribe the **Instagram** object to `messages`, with Callback URL:
   - `https://your-server.example.com/webhook/instagram`
   - Verify Token: same `META_VERIFY_TOKEN`
3. The same `META_PAGE_ACCESS_TOKEN` is reused to send IG replies.
4. DM your connected Instagram account to test.

## 5. WhatsApp

1. In your Meta App, add the **WhatsApp** product.
2. From WhatsApp → API Setup, grab:
   - A temporary (or permanent, via a System User) access token → `WHATSAPP_ACCESS_TOKEN`
   - The **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
3. Pick a random string for `WHATSAPP_VERIFY_TOKEN`.
4. Under Configuration → Webhook, set:
   - Callback URL: `https://your-server.example.com/webhook/whatsapp`
   - Verify Token: same `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the `messages` field.
5. Send a WhatsApp message to the test number to see the bot reply.

## 6. Gmail

The Gmail channel auto-replies to unread mail in an inbox you authorize. It uses OAuth2 (a real user grants access) rather than a service account, since replying "as" a personal/company inbox needs delegated permission.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Gmail API**, and create an **OAuth 2.0 Client ID** (type: Web application).
2. Add an authorized redirect URI matching `GMAIL_REDIRECT_URI` (default `http://localhost:3000/gmail/oauth2callback` — update it to your deployed HTTPS URL in production).
3. Put the Client ID/Secret into `.env` as `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`.
4. Start the server (`npm run dev`) and visit `/gmail/auth` in a browser. Log in with the Gmail account you want the bot to monitor and grant access.
5. Run the poller, which checks for unread mail and replies automatically:
   ```bash
   npm run gmail:poll
   ```
   It polls every `GMAIL_POLL_INTERVAL_MS` (default 60s). Set `GMAIL_IGNORE_SENDERS` to a comma-separated list of addresses that should never trigger an auto-reply (useful for avoiding bot-to-bot loops with mailing lists, no-reply addresses, etc.).

For production, prefer [Gmail push notifications via Cloud Pub/Sub](https://developers.google.com/gmail/api/guides/push) over polling — it's near-instant and cheaper on quota. The polling approach here is the simplest way to get started without provisioning Pub/Sub.

## Feeding it a knowledge base ("training" it on your data)

The bot doesn't get fine-tuned — instead it does retrieval: every incoming
message is matched against your own documents, and the most relevant
snippets are handed to the model as context before it replies. This is the
standard, practical way to ground a support bot in your content.

1. Drop `.txt` or `.md` files into the `knowledge/` folder (subfolders are fine). One file per topic, or one big file — either works. Within a file, separate distinct facts/topics with a blank line; the bot retrieves paragraph by paragraph, so one idea per paragraph gives better results than one giant wall of text.
2. Restart the server (`npm run dev`), or if it's already running, call:
   ```bash
   curl -X POST http://localhost:3000/knowledge/reload
   ```
3. Check what's loaded:
   ```bash
   curl http://localhost:3000/knowledge/status
   ```
4. Ask the widget/channel a question covered by your docs — the model will ground its answer in the retrieved text and say it doesn't know when nothing matches.

This works the same across every channel (website, Facebook, Instagram, WhatsApp, Gmail) since they all share `generateReply()`. There's no vector database or embeddings API involved — retrieval uses a lightweight TF-IDF match over your files (`src/core/knowledgeBase.ts`), which is enough for FAQs/docs in the tens-to-low-hundreds of pages. If you outgrow that, swap `knowledgeBase.ts` for a real vector store (e.g. Pinecone, pgvector) behind the same `retrieveContext()` function.

## Customizing the bot

- Edit `BOT_PERSONA` in `.env` to change tone/instructions globally.
- Per-channel tweaks (e.g. shorter replies on SMS-like channels) live in `channelNotes` inside `src/core/chatbot.ts`.
- To hand off to a human, have the model include a marker phrase in its reply and check for it in each channel's router before sending — the hook points are already there (`generateReply` return value in each router).

## Deploying to Render

This repo includes a `render.yaml` blueprint, so Render can set most of it up automatically.

1. Push this repo to GitHub if it isn't already there.
2. Go to https://dashboard.render.com → **New** → **Blueprint**, and point it at this repo. Render reads `render.yaml` and creates a **Web Service** for you (build: `npm install && npm run build`, start: `npm start`).
3. During setup, Render will prompt you to fill in the env vars marked `sync: false` in `render.yaml` (secrets it can't guess) — at minimum:
   - `AI_PROVIDER` (`anthropic` or `openai`) and the matching API key
   - `BOT_PERSONA`
   - Whichever channel's credentials you're connecting first (Meta/WhatsApp/Gmail — see the sections above). You can leave the others blank until you're ready for that channel; missing values just mean that channel's webhook calls will fail until set.
4. Deploy. Render gives you a public URL like `https://aichatagents.onrender.com` — that's your "server URL" for every webhook config in the sections above (Facebook, Instagram, WhatsApp callback URLs; Gmail's `GMAIL_REDIRECT_URI`).
5. After deploying, update `GMAIL_REDIRECT_URI` to `https://aichatagents.onrender.com/gmail/oauth2callback` (both in Render's env vars *and* in the Google Cloud Console OAuth client's authorized redirect URIs), then visit `https://aichatagents.onrender.com/gmail/auth` to connect Gmail.
6. Whenever you push new commits to the connected branch, Render redeploys automatically.

**Free tier notes:**
- Render's free web services spin down after inactivity and take ~30-60s to wake on the next request — fine for testing, consider a paid plan before relying on it for real customer traffic.
- The Gmail poller (`npm run gmail:poll`) needs to run continuously, which a free web service won't do reliably on its own. Add it as a second service in Render (**Background Worker**, same repo, start command `npm run gmail:poll`), or run it elsewhere.
- `gmail-token.json` is written to local disk after you authorize — Render's free tier disk isn't persistent across deploys, so you'll need to re-run `/gmail/auth` after each redeploy unless you're on a paid plan with a persistent disk, or you switch the poller to store the token somewhere durable (e.g. an env var or a database) instead.

## Deploying elsewhere

```bash
npm run build
npm start
```

Run the Gmail poller (`npm run gmail:poll`) as a separate process/service if you're using that channel — it's independent of the webhook server.

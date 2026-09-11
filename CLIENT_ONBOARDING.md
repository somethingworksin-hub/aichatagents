# Client Onboarding Checklist (Done-For-You Model)

Use this for every new client until the multi-tenant product exists. Each
client gets their own deployed instance of this repo (their own Render
service, their own env vars, their own `knowledge/` content). ~5-10 hours of
setup work per client once you've done it once or twice.

## 1. Sales / scoping (before any building)
- [ ] Confirm which channels they want (website / FB / IG / WhatsApp / Gmail) — price by channel count
- [ ] Get their FAQ/docs/policies — this becomes `knowledge/`. If they don't have it written down, run a 30-60 min call and write it yourself
- [ ] Agree pricing: setup fee (covers your hours) + monthly fee (covers hosting + your maintenance time + margin)
- [ ] Set expectations: they need admin access to their own Facebook Page, Meta Business account, WhatsApp number, Google account, and website — you can't get these for them

## 2. Repo setup per client
- [ ] Fork or duplicate this repo (or use one repo with per-client branches/deploys — simplest: one Render service per client, same codebase, different env vars)
- [ ] Write their `knowledge/*.md` files from what you collected in step 1
- [ ] Set `BOT_NAME` / `BOT_PERSONA` to match their brand voice

## 3. Deploy
- [ ] New Render service for this client (Blueprint deploy from `render.yaml`)
- [ ] Fill in `AI_PROVIDER` + API key (use your own OpenAI/Anthropic key and bill them monthly, or have them provide their own key — decide this per client, it affects your margin and their bill-shock risk)
- [ ] Confirm `/health` and `/demo.html` work on the deployed URL

## 4. Connect channels (only the ones they asked for)
- [ ] **Website**: give them the `<script>` snippet to paste into their site (or do it yourself if you manage their site)
- [ ] **WhatsApp**: Meta app + Cloud API setup, using *their* Meta Business account (see README §5)
- [ ] **Facebook**: Messenger webhook on *their* Page (README §3)
- [ ] **Instagram**: same Meta app, their IG account linked (README §4)
- [ ] **Gmail**: OAuth against *their* Gmail/Workspace account (README §6) — note the Render free-tier token-persistence caveat, use a paid plan for real clients

## 5. Test before handoff
- [ ] Ask it 10 real questions a customer would ask — check answers against their actual policies
- [ ] Test the "I don't know" / escalation behavior with an out-of-scope question
- [ ] Test on mobile (website widget) and on the actual WhatsApp/IG/FB apps, not just Postman

## 6. Handoff
- [ ] Show them how to edit `knowledge/` and trigger a reload (or do this for them as a paid update — decide once, keep consistent)
- [ ] Give them a support contact/process for "the bot said something wrong" reports
- [ ] Document what you'd need to check monthly per client (usage/cost creep, model deprecations, Meta API changes)

## 7. Ongoing (the recurring revenue part)
- [ ] Monthly: check Render logs for errors, check API usage/cost vs. what you're billing them
- [ ] Update `knowledge/` when their policies change
- [ ] Re-authorize Gmail OAuth if the token lapses

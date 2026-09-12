# Client Onboarding Checklist

Now that the platform is multi-tenant, onboarding a new client means creating
a **tenant** on the one shared deployment via the admin API — not deploying
a whole new instance per client. ~2-4 hours of setup work per client once
you've done it once or twice (mostly collecting their content and channel
credentials, not infrastructure).

## 1. Sales / scoping (before any building)
- [ ] Confirm which channels they want (website / FB / IG / WhatsApp / Gmail) — price by channel count
- [ ] Get their FAQ/docs/policies — this becomes their knowledge base. If they don't have it written down, run a 30-60 min call and write it yourself
- [ ] Agree pricing: setup fee (covers your hours) + monthly fee (covers your AI usage costs if you're providing the key, hosting share, and margin)
- [ ] Set expectations: they need admin access to their own Facebook Page, Meta Business account, WhatsApp number, Google account, and website — you can't get these for them
- [ ] Decide: does this client bring their own OpenAI/Anthropic API key, or do you provide one and bill them for usage? Affects your margin and their bill-shock risk

## 2. Create the tenant
```bash
curl -X POST https://your-server/admin/tenants \
  -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{
    "name": "Client Name",
    "ai": { "provider": "openai", "apiKey": "sk-xxxxx", "model": "gpt-4o-mini" },
    "bot": { "name": "...", "persona": "..." },
    "website": {}
  }'
```
Save the returned `id` (used in every other admin call) and `website.siteKey` (used in their widget snippet).

## 3. Upload their knowledge base
```bash
curl -X POST https://your-server/admin/tenants/TENANT_ID/knowledge \
  -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"source": "FAQ", "text": "... paragraph per fact ..."}'
```
Repeat per document/topic. See README §9 for formatting guidance.

## 4. Connect channels (only the ones they asked for)
- [ ] **Website**: give them the `<script>` snippet with their `siteKey` (README §4)
- [ ] **Facebook**: their Page ID + Page Access Token, `PATCH`ed onto the tenant (README §5)
- [ ] **Instagram**: their IG account ID + Page Access Token (README §6)
- [ ] **WhatsApp**: their phone number ID + access token (README §7)
- [ ] **Gmail**: they (or you, on their behalf) visit `/gmail/auth?tenantId=TENANT_ID` to authorize (README §8) — no manual `PATCH` needed, tokens store themselves

## 5. Test before handoff
- [ ] Ask it 10 real questions a customer would ask — check answers against their actual policies
- [ ] Test the "I don't know" / escalation behavior with an out-of-scope question
- [ ] Test on mobile (website widget) and on the actual WhatsApp/IG/FB apps, not just curl

## 6. Handoff
- [ ] Show them how to send you updated content, or how to call the knowledge API themselves if they're technical
- [ ] Give them a support contact/process for "the bot said something wrong" reports
- [ ] Note what to check monthly per client (usage/cost creep, model deprecations, Meta API changes, Gmail token still valid)

## 7. Ongoing (the recurring revenue part)
- [ ] Monthly: check server logs for errors, check API usage/cost vs. what you're billing them (per-tenant cost tracking isn't built yet — for now, check each tenant's provider dashboard if they're on your key)
- [ ] Update their knowledge base when policies change (`POST`/`DELETE` on `/admin/tenants/TENANT_ID/knowledge`)
- [ ] Re-run Gmail OAuth if their token lapses (refresh tokens are long-lived but can be revoked)

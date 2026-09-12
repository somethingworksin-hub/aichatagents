import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { websiteRouter } from "./channels/website/router";
import { facebookRouter } from "./channels/facebook/router";
import { instagramRouter } from "./channels/instagram/router";
import { whatsappRouter } from "./channels/whatsapp/router";
import { gmailRouter } from "./channels/gmail/router";
import { adminRouter } from "./channels/admin/router";

const app = express();

// Capture the raw body so Meta webhook signature verification can hash the
// exact bytes that were sent (JSON.stringify(req.body) is not guaranteed to
// match the original payload byte-for-byte).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

// The website widget can be embedded on any tenant's site, and identifies
// itself with a per-tenant siteKey rather than a fixed origin allowlist, so
// CORS itself stays open — see Tenant.website.allowedOrigins if you want to
// additionally enforce per-tenant origin checks inside the website router.
app.use(cors({ origin: true }));

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(websiteRouter);
app.use(facebookRouter);
app.use(instagramRouter);
app.use(whatsappRouter);
app.use(gmailRouter);
app.use(adminRouter);

app.listen(config.port, () => {
  console.log(`AI chat agents server listening on port ${config.port}`);
  console.log(`  Website demo:        http://localhost:${config.port}/demo.html`);
  console.log(`  Facebook webhook:    http://localhost:${config.port}/webhook/facebook`);
  console.log(`  Instagram webhook:   http://localhost:${config.port}/webhook/instagram`);
  console.log(`  WhatsApp webhook:    http://localhost:${config.port}/webhook/whatsapp`);
  console.log(`  Gmail auth:          http://localhost:${config.port}/gmail/auth?tenantId=YOUR_TENANT_ID`);
  console.log(`  Admin API:           http://localhost:${config.port}/admin/tenants`);
});

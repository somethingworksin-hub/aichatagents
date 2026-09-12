import { Router } from "express";
import crypto from "crypto";
import { config } from "../../config";
import { createTenant, updateTenant, listTenants, getTenant, Tenant } from "../../core/tenant";
import { addKnowledgeText, clearKnowledge, listKnowledgeSources } from "../../core/knowledgeBase";

export const adminRouter = Router();

/**
 * Minimal secret-protected REST API for managing tenants until a real
 * dashboard/auth UI exists (see CLIENT_ONBOARDING.md / README for the
 * curl-based workflow this is meant to support).
 */
adminRouter.use("/admin", (req, res, next) => {
  if (!config.adminApiKey) {
    return res.status(503).json({ error: "ADMIN_API_KEY is not configured on this server." });
  }
  if (req.header("x-admin-key") !== config.adminApiKey) {
    return res.sendStatus(403);
  }
  next();
});

adminRouter.post("/admin/tenants", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.name || !body.ai?.provider || !body.ai?.apiKey || !body.bot?.name || !body.bot?.persona) {
      return res.status(400).json({
        error: "Required: name, ai.provider, ai.apiKey, bot.name, bot.persona. Optional: website, facebook, instagram, whatsapp.",
      });
    }

    const input: Omit<Tenant, "id" | "createdAt" | "updatedAt"> = {
      name: body.name,
      ai: { provider: body.ai.provider, apiKey: body.ai.apiKey, model: body.ai.model },
      bot: { name: body.bot.name, persona: body.bot.persona },
    };

    if (body.website) {
      input.website = { siteKey: body.website.siteKey || crypto.randomUUID(), allowedOrigins: body.website.allowedOrigins };
    }
    if (body.facebook) input.facebook = body.facebook;
    if (body.instagram) input.instagram = body.instagram;
    if (body.whatsapp) input.whatsapp = body.whatsapp;

    const tenant = await createTenant(input);
    res.status(201).json(tenant);
  } catch (err) {
    console.error("[admin] create tenant failed", err);
    res.status(500).json({ error: "Failed to create tenant." });
  }
});

adminRouter.get("/admin/tenants", async (_req, res) => {
  try {
    res.json(await listTenants());
  } catch (err) {
    console.error("[admin] list tenants failed", err);
    res.status(500).json({ error: "Failed to list tenants." });
  }
});

adminRouter.get("/admin/tenants/:id", async (req, res) => {
  try {
    const tenant = await getTenant(req.params.id);
    if (!tenant) return res.sendStatus(404);
    res.json(tenant);
  } catch (err) {
    console.error("[admin] get tenant failed", err);
    res.status(500).json({ error: "Failed to fetch tenant." });
  }
});

adminRouter.patch("/admin/tenants/:id", async (req, res) => {
  try {
    const existing = await getTenant(req.params.id);
    if (!existing) return res.sendStatus(404);
    const tenant = await updateTenant(req.params.id, req.body ?? {});
    res.json(tenant);
  } catch (err) {
    console.error("[admin] update tenant failed", err);
    res.status(500).json({ error: "Failed to update tenant." });
  }
});

// --- Knowledge base management (replaces the old file-based /knowledge/* routes) ---

adminRouter.get("/admin/tenants/:id/knowledge", async (req, res) => {
  try {
    res.json(await listKnowledgeSources(req.params.id));
  } catch (err) {
    console.error("[admin] list knowledge failed", err);
    res.status(500).json({ error: "Failed to list knowledge." });
  }
});

adminRouter.post("/admin/tenants/:id/knowledge", async (req, res) => {
  try {
    const { source, text } = req.body ?? {};
    if (!source || !text) {
      return res.status(400).json({ error: "Required: source (a label), text (raw content to chunk & index)." });
    }
    const chunks = await addKnowledgeText(req.params.id, source, text);
    res.status(201).json({ added: chunks });
  } catch (err) {
    console.error("[admin] add knowledge failed", err);
    res.status(500).json({ error: "Failed to add knowledge." });
  }
});

adminRouter.delete("/admin/tenants/:id/knowledge", async (req, res) => {
  try {
    await clearKnowledge(req.params.id);
    res.json({ cleared: true });
  } catch (err) {
    console.error("[admin] clear knowledge failed", err);
    res.status(500).json({ error: "Failed to clear knowledge." });
  }
});

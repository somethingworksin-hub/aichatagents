import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { config } from "../../config";
import { createTenant, updateTenant, listTenants, getTenant, deleteTenant, Tenant } from "../../core/tenant";
import {
  addKnowledgeText,
  clearKnowledge,
  deleteKnowledgeChunk,
  listKnowledgeSources,
  previewRetrieval,
} from "../../core/knowledgeBase";
import { extractTextFromUrl, extractTextFromFile } from "../../core/documentExtract";

export const adminRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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

adminRouter.delete("/admin/tenants/:id", async (req, res) => {
  try {
    const existing = await getTenant(req.params.id);
    if (!existing) return res.sendStatus(404);
    await clearKnowledge(req.params.id);
    await deleteTenant(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error("[admin] delete tenant failed", err);
    res.status(500).json({ error: "Failed to delete tenant." });
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

adminRouter.post("/admin/tenants/:id/knowledge/preview", async (req, res) => {
  try {
    const { message } = req.body ?? {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Required: message (a sample question to test retrieval against)." });
    }
    const matches = await previewRetrieval(req.params.id, message);
    res.json({ matches });
  } catch (err) {
    console.error("[admin] preview retrieval failed", err);
    res.status(500).json({ error: "Failed to preview retrieval." });
  }
});

adminRouter.post("/admin/tenants/:id/knowledge/from-url", async (req, res) => {
  try {
    const { url } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Required: url" });
    }
    const text = await extractTextFromUrl(url);
    const chunks = await addKnowledgeText(req.params.id, url, text);
    res.status(201).json({ added: chunks, source: url });
  } catch (err: any) {
    console.error("[admin] add knowledge from URL failed", err);
    res.status(400).json({ error: err?.message || "Failed to read that URL." });
  }
});

adminRouter.post("/admin/tenants/:id/knowledge/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Required: file (multipart form field named 'file')" });
    }
    const text = await extractTextFromFile(file.buffer, file.originalname);
    if (!text.trim()) {
      return res.status(400).json({ error: "Couldn't extract any text from that file." });
    }
    const chunks = await addKnowledgeText(req.params.id, file.originalname, text);
    res.status(201).json({ added: chunks, source: file.originalname });
  } catch (err: any) {
    console.error("[admin] add knowledge from upload failed", err);
    res.status(400).json({ error: err?.message || "Failed to process that file." });
  }
});

adminRouter.delete("/admin/tenants/:id/knowledge/:chunkId", async (req, res) => {
  try {
    await deleteKnowledgeChunk(req.params.id, req.params.chunkId);
    res.json({ deleted: true });
  } catch (err) {
    console.error("[admin] delete knowledge chunk failed", err);
    res.status(500).json({ error: "Failed to delete knowledge chunk." });
  }
});

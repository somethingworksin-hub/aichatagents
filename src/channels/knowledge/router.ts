import { Router } from "express";
import { reloadKnowledgeBase, knowledgeBaseStatus } from "../../core/knowledgeBase";

export const knowledgeRouter = Router();

// Check what's currently loaded.
knowledgeRouter.get("/knowledge/status", (_req, res) => {
  res.json(knowledgeBaseStatus());
});

// Call this after adding/editing files under ./knowledge to pick up changes
// without restarting the whole server.
knowledgeRouter.post("/knowledge/reload", (_req, res) => {
  const result = reloadKnowledgeBase();
  res.json({ reloaded: true, ...result });
});

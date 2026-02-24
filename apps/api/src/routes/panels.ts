import { Router } from "express";
import { prisma } from "@rail/db";
import { panelConfigSchema, panelUpdateSchema } from "@rail/shared";
import { requireSession, requireStaff } from "../middleware/auth.js";
import { syncPanelMessage } from "../services/panels.js";

export const panelsRouter = Router();

panelsRouter.get("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const panels = await prisma.ticketPanel.findMany({
    where: { guildId },
    include: {
      categories: {
        include: { category: true },
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { updatedAt: "desc" }
  });
  res.json({ panels });
});

panelsRouter.post("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const input = panelConfigSchema.parse(req.body);
  const existing = await prisma.ticketPanel.findFirst({
    where: { guildId, channelId: input.channelId, isActive: true }
  });
  if (existing) {
    res.status(400).json({ error: "panel_exists" });
    return;
  }
  const panel = await prisma.ticketPanel.create({
    data: {
      guildId,
      channelId: input.channelId,
      title: input.title,
      description: input.description,
      ...(input.categoryIds.length > 0 && {
        categories: {
          create: input.categoryIds.map((categoryId, index) => ({
            categoryId,
            sortOrder: index,
            enabled: true
          }))
        }
      })
    }
  });
  res.json({ panel });
});

panelsRouter.put("/:id", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const panelId = String(req.params.id || "");
  const input = panelUpdateSchema.parse(req.body);
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId }
  });
  if (!panel) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const existing = await prisma.ticketPanel.findFirst({
    where: {
      guildId,
      channelId: input.channelId,
      isActive: true,
      id: { not: panelId }
    }
  });
  if (existing) {
    res.status(400).json({ error: "panel_exists" });
    return;
  }
  await prisma.ticketPanelCategory.deleteMany({
    where: { panelId }
  });
  const updated = await prisma.ticketPanel.update({
    where: { id: panelId },
    data: {
      channelId: input.channelId,
      title: input.title,
      description: input.description,
      categories: {
        create: input.categories.map((category, index) => ({
          categoryId: category.id,
          enabled: category.enabled,
          sortOrder: index
        }))
      }
    }
  });
  res.json({ panel: updated });
});

panelsRouter.post("/:id/publish", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const panelId = String(req.params.id || "");
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId }
  });
  if (!panel) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await syncPanelMessage(panelId);
  res.json({ ok: true });
});

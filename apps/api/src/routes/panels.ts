import { Router } from "express";
import { prisma } from "@rail/db";
import { Prisma } from "@prisma/client";
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
  try {
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2000") {
      res.status(400).json({ error: "panel_field_too_long" });
      return;
    }
    throw error;
  }
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
  try {
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2000") {
      res.status(400).json({ error: "panel_field_too_long" });
      return;
    }
    throw error;
  }
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
  try {
    await syncPanelMessage(panelId);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "bot_internal_missing") {
      res.status(500).json({ error: "bot_internal_missing" });
      return;
    }
    res.status(502).json({ error: "bot_sync_failed" });
  }
});

panelsRouter.delete("/:id", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const panelId = String(req.params.id || "");
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId }
  });
  if (!panel) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await prisma.ticketPanelCategory.deleteMany({ where: { panelId } });
  await prisma.ticketPanel.delete({ where: { id: panelId } });
  res.json({ ok: true });
});

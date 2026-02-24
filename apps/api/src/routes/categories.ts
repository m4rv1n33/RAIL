import { Router } from "express";
import { prisma } from "@rail/db";
import { Prisma } from "@prisma/client";
import { categorySchema } from "@rail/shared";
import { requireSession, requireStaff } from "../middleware/auth.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const categories = await prisma.ticketCategory.findMany({
    where: { guildId },
    orderBy: { sortOrder: "asc" }
  });
  res.json({ categories });
});

categoriesRouter.post("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const input = categorySchema.parse(req.body);
  const category = await prisma.ticketCategory.create({
    data: {
      ...input,
      guildId,
      modalSchema: input.modalSchema ?? Prisma.JsonNull
    }
  });
  res.json({ category });
});

categoriesRouter.put("/:id", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const id = String(req.params.id || "");
  const input = categorySchema.parse(req.body);
  const category = await prisma.ticketCategory.update({
    where: { id, guildId },
    data: {
      ...input,
      modalSchema: input.modalSchema ?? Prisma.JsonNull
    }
  });
  res.json({ category });
});

categoriesRouter.delete("/:id", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const id = String(req.params.id || "");
  const category = await prisma.ticketCategory.findFirst({
    where: { id, guildId }
  });
  if (!category) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const ticketCount = await prisma.ticket.count({
    where: { guildId, categoryId: id }
  });
  if (ticketCount > 0) {
    res.status(409).json({ error: "category_in_use" });
    return;
  }

  await prisma.ticketPanelCategory.deleteMany({ where: { categoryId: id } });
  await prisma.ticketCategory.delete({ where: { id } });
  res.json({ ok: true });
});

import { Router } from "express";
import { prisma } from "@ukrrp/db";
import { requireSession, requireStaff } from "../middleware/auth.js";
import { z } from "zod";

export const teamsRouter = Router();

const teamSchema = z.object({
  name: z.string().min(2).max(64),
  roleIds: z.array(z.string().min(1)).default([])
});

teamsRouter.get("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const teams = await prisma.supportTeam.findMany({
    where: { guildId },
    include: { roles: true }
  });
  res.json({ teams });
});

teamsRouter.post("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const input = teamSchema.parse(req.body);
  const team = await prisma.supportTeam.create({
    data: {
      guildId,
      name: input.name,
      roles: {
        create: input.roleIds.map((roleId) => ({ roleId }))
      }
    },
    include: { roles: true }
  });
  res.json({ team });
});

teamsRouter.put("/:id", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const id = String(req.params.id || "");
  const input = teamSchema.parse(req.body);
  await prisma.supportTeamRole.deleteMany({
    where: { teamId: id }
  });
  const team = await prisma.supportTeam.update({
    where: { id, guildId },
    data: {
      name: input.name,
      roles: {
        create: input.roleIds.map((roleId) => ({ roleId }))
      }
    },
    include: { roles: true }
  });
  res.json({ team });
});

teamsRouter.delete("/:id", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const id = String(req.params.id || "");
  const team = await prisma.supportTeam.findFirst({
    where: { id, guildId }
  });
  if (!team) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const [categoryCount, ticketCount] = await Promise.all([
    prisma.ticketCategory.count({ where: { guildId, supportTeamId: id } }),
    prisma.ticket.count({ where: { guildId, supportTeamId: id } })
  ]);

  if (categoryCount > 0 || ticketCount > 0) {
    res.status(409).json({ error: "team_in_use" });
    return;
  }

  await prisma.supportTeamRole.deleteMany({ where: { teamId: id } });
  await prisma.supportTeam.delete({ where: { id } });
  res.json({ ok: true });
});

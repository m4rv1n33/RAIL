import { Router } from "express";
import { prisma } from "@rail/db";
import { evaluateAccess, requireDashboardAccess, requireSession } from "../middleware/auth.js";
import { fetchDiscordUserById, fetchGuildMember, fetchGuildRoles } from "../services/discord.js";
import { forceCloseOpenTickets } from "../services/tickets.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";

export const transcriptsRouter = Router();
const formatTicketLabel = (ticketNumber: number | null | undefined, ticketId: string) => {
  if (typeof ticketNumber === "number") {
    return `ticket-${String(ticketNumber).padStart(4, "0")}`;
  }
  return `ticket-${ticketId.slice(0, 6)}`;
};

const getLatestRenameByTicketId = async (ticketIds: string[]) => {
  if (ticketIds.length === 0) {
    return new Map<string, string>();
  }

  const renameEvents = await prisma.ticketEvent.findMany({
    where: {
      ticketId: { in: ticketIds },
      type: "RENAME"
    },
    select: {
      ticketId: true,
      data: true,
      createdAt: true
    },
    orderBy: [{ ticketId: "asc" }, { createdAt: "desc" }]
  });

  const map = new Map<string, string>();
  for (const event of renameEvents) {
    if (map.has(event.ticketId)) {
      continue;
    }
    const payload = event.data as { name?: unknown } | null;
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    if (name) {
      map.set(event.ticketId, name);
    }
  }

  return map;
};

const resolveUsernames = async (ids: string[]) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const user = await fetchDiscordUserById(id);
        map.set(id, user?.username || id);
      } catch {
        map.set(id, id);
      }
    })
  );
  return map;
};

const getAccessibleSupportTeamIds = async (guildId: string, userId: string, isFullAccess: boolean) => {
  if (isFullAccess) {
    return null;
  }

  let member: Awaited<ReturnType<typeof fetchGuildMember>> = null;
  let guildRoles: Awaited<ReturnType<typeof fetchGuildRoles>> = [];
  let supportTeams: Array<{ id: string; roles: Array<{ roleId: string }> }> = [];

  try {
    [member, guildRoles, supportTeams] = await Promise.all([
      fetchGuildMember(guildId, userId),
      fetchGuildRoles(guildId),
      prisma.supportTeam.findMany({
        where: { guildId },
        select: {
          id: true,
          roles: {
            select: {
              roleId: true
            }
          }
        }
      })
    ]);
  } catch (error) {
    console.warn("[transcripts] Failed to resolve hierarchy access; returning no accessible teams", {
      guildId,
      userId,
      message: error instanceof Error ? error.message : "unknown_error"
    });
    return new Set<string>();
  }

  if (!member) {
    return new Set<string>();
  }

  const memberRoleIds = new Set<string>(member.roles || []);
  const rolePositionById = new Map<string, number>(guildRoles.map((role) => [role.id, role.position]));
  const memberHighestPosition = [...memberRoleIds].reduce((highest, roleId) => {
    const position = rolePositionById.get(roleId);
    return typeof position === "number" ? Math.max(highest, position) : highest;
  }, -1);

  if (memberHighestPosition < 0) {
    return new Set<string>();
  }

  const allowedSupportTeamIds = new Set<string>();
  supportTeams.forEach((team) => {
    const teamRoleIds = team.roles.map((role) => role.roleId);
    const hasDirectTeamRole = teamRoleIds.some((roleId) => memberRoleIds.has(roleId));
    const teamHighestPosition = teamRoleIds.reduce((highest, roleId) => {
      const position = rolePositionById.get(roleId);
      return typeof position === "number" ? Math.max(highest, position) : highest;
    }, -1);

    if (hasDirectTeamRole || (teamHighestPosition >= 0 && teamHighestPosition <= memberHighestPosition)) {
      allowedSupportTeamIds.add(team.id);
    }
  });

  return allowedSupportTeamIds;
};

transcriptsRouter.get("/", requireSession, requireDashboardAccess, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const userId = String(req.session.user?.id || "");
  const access = await evaluateAccess(req, res);
  if (!access) {
    return;
  }

  const accessibleSupportTeamIds = await getAccessibleSupportTeamIds(
    guildId,
    userId,
    access.isSuperuser || access.isAdmin
  );
  if (accessibleSupportTeamIds && accessibleSupportTeamIds.size === 0) {
    res.json({ transcripts: [] });
    return;
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      guildId,
      ...(accessibleSupportTeamIds
        ? { supportTeamId: { in: [...accessibleSupportTeamIds] } }
        : {})
    },
    include: {
      events: {
        where: { type: "CLOSE" },
        orderBy: { createdAt: "desc" },
        take: 1
      },
      transcript: true
    },
    orderBy: { updatedAt: "desc" }
  });

  const transcripts = tickets
    .filter((ticket) => ticket.transcript)
    .map((ticket) => ({
      ticketId: ticket.id,
      generatedTicketLabel: formatTicketLabel((ticket as { ticketNumber?: number }).ticketNumber, ticket.id),
      openedById: ticket.ownerId,
      closedById: ticket.events[0]?.actorId || null,
      reason: ticket.closeReason || null,
      openedAt: ticket.createdAt,
      closedAt: ticket.closedAt,
      hasTranscript: Boolean(ticket.transcript)
    }));

  const latestRenameByTicketId = await getLatestRenameByTicketId(transcripts.map((entry) => entry.ticketId));

  const usernameMap = await resolveUsernames(
    transcripts.flatMap((entry) => [entry.openedById, entry.closedById || ""])
  );

  res.json({
    transcripts: transcripts.map((entry) => ({
      ...entry,
      ticketLabel: latestRenameByTicketId.get(entry.ticketId) || entry.generatedTicketLabel,
      openedByName: usernameMap.get(entry.openedById) || entry.openedById,
      closedByName: entry.closedById ? usernameMap.get(entry.closedById) || entry.closedById : null
    }))
  });
});

transcriptsRouter.get("/:ticketId", requireSession, requireDashboardAccess, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const userId = String(req.session.user?.id || "");
  const ticketId = String(req.params.ticketId || "");
  const access = await evaluateAccess(req, res);
  if (!access) {
    return;
  }

  const accessibleSupportTeamIds = await getAccessibleSupportTeamIds(
    guildId,
    userId,
    access.isSuperuser || access.isAdmin
  );

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId },
    include: {
      events: {
        where: { type: "CLOSE" },
        orderBy: { createdAt: "desc" },
        take: 1
      },
      transcript: true
    }
  });

  if (!ticket || !ticket.transcript) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (accessibleSupportTeamIds && !accessibleSupportTeamIds.has(ticket.supportTeamId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const latestRenameByTicketId = await getLatestRenameByTicketId([ticket.id]);
  const usernameMap = await resolveUsernames([ticket.ownerId, ticket.events[0]?.actorId || ""]);

  res.json({
    transcript: {
      ticketId: ticket.id,
      ticketLabel:
        latestRenameByTicketId.get(ticket.id) ||
        formatTicketLabel((ticket as { ticketNumber?: number }).ticketNumber, ticket.id),
      openedById: ticket.ownerId,
      openedByName: usernameMap.get(ticket.ownerId) || ticket.ownerId,
      closedById: ticket.events[0]?.actorId || null,
      closedByName: ticket.events[0]?.actorId
        ? usernameMap.get(ticket.events[0].actorId) || ticket.events[0].actorId
        : null,
      reason: ticket.closeReason || null,
      openedAt: ticket.createdAt,
      closedAt: ticket.closedAt,
      content: ticket.transcript.content,
      transcriptCreatedAt: ticket.transcript.createdAt
    }
  });
});

transcriptsRouter.delete("/", requireSession, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const userId = String(req.session.user?.id || "");
  if (!isConfiguredSuperuser(userId)) {
    res.status(403).json({ error: "superuser_only" });
    return;
  }

  const deleted = await prisma.ticketTranscript.deleteMany({
    where: {
      ticket: { guildId }
    }
  });

  res.json({ ok: true, deletedCount: deleted.count });
});

transcriptsRouter.post("/force-close-open", requireSession, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const userId = String(req.session.user?.id || "");
  if (!isConfiguredSuperuser(userId)) {
    res.status(403).json({ error: "superuser_only" });
    return;
  }
  try {
    const result = await forceCloseOpenTickets(guildId);
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "bot_internal_missing") {
      res.status(500).json({ error: "bot_internal_missing" });
      return;
    }
    if (error instanceof Error && error.message === "bot_internal_unreachable") {
      res.status(502).json({ error: "bot_internal_unreachable" });
      return;
    }
    if (error instanceof Error && error.message === "bot_internal_unauthorized") {
      res.status(502).json({ error: "bot_internal_unauthorized" });
      return;
    }
    res.status(502).json({ error: "bot_force_close_failed" });
  }
});


import { Router } from "express";
import { prisma } from "@ukrrp/db";
import { requireDashboardAccess, requireSession } from "../middleware/auth.js";
import { fetchDiscordUserById } from "../services/discord.js";
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

transcriptsRouter.get("/", requireSession, requireDashboardAccess, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const tickets = await prisma.ticket.findMany({
    where: { guildId },
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
  const ticketId = String(req.params.ticketId || "");
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

import { Router } from "express";
import { prisma } from "@rail/db";
import { requireSession, requireStaff } from "../middleware/auth.js";
import { fetchDiscordUserById } from "../services/discord.js";
import { forceCloseOpenTickets } from "../services/tickets.js";

export const transcriptsRouter = Router();
const SUPERUSER_ID = process.env.DEV_BYPASS_USER_ID || "";
const formatTicketLabel = (ticketNumber: number | null | undefined, ticketId: string) => {
  if (typeof ticketNumber === "number") {
    return `ticket-${String(ticketNumber).padStart(4, "0")}`;
  }
  return `ticket-${ticketId.slice(0, 6)}`;
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

transcriptsRouter.get("/", requireSession, requireStaff, async (req, res) => {
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
      ticketLabel: formatTicketLabel((ticket as { ticketNumber?: number }).ticketNumber, ticket.id),
      openedById: ticket.ownerId,
      closedById: ticket.events[0]?.actorId || null,
      reason: ticket.closeReason || null,
      openedAt: ticket.createdAt,
      closedAt: ticket.closedAt,
      hasTranscript: Boolean(ticket.transcript)
    }));

  const usernameMap = await resolveUsernames(
    transcripts.flatMap((entry) => [entry.openedById, entry.closedById || ""])
  );

  res.json({
    transcripts: transcripts.map((entry) => ({
      ...entry,
      openedByName: usernameMap.get(entry.openedById) || entry.openedById,
      closedByName: entry.closedById ? usernameMap.get(entry.closedById) || entry.closedById : null
    }))
  });
});

transcriptsRouter.get("/:ticketId", requireSession, requireStaff, async (req, res) => {
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

  const usernameMap = await resolveUsernames([ticket.ownerId, ticket.events[0]?.actorId || ""]);

  res.json({
    transcript: {
      ticketId: ticket.id,
      ticketLabel: formatTicketLabel((ticket as { ticketNumber?: number }).ticketNumber, ticket.id),
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
  if (userId !== SUPERUSER_ID) {
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
  if (userId !== SUPERUSER_ID) {
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
    res.status(502).json({ error: "bot_force_close_failed" });
  }
});

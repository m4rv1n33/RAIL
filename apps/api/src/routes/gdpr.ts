import { Router } from "express";
import { prisma } from "@ukrrp/db";
import { requireSession } from "../middleware/auth.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";
import { v4 as uuidv4 } from "uuid";

export const gdprRouter = Router();

// Helper to get client IP
const getClientIp = (req: any): string => {
  return (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown") as string;
};

// Helper to get user agent
const getUserAgent = (req: any): string => {
  return (req.headers["user-agent"] || "unknown") as string;
};

/**
 * GET /api/gdpr/export
 * Export user's personal data (Article 20 - Data Portability)
 */
gdprRouter.get("/export", requireSession, async (req, res) => {
  const userId = req.session.user?.id;
  const guildId = String(req.headers["x-guild-id"] || "");

  if (!userId || !guildId) {
    res.status(400).json({ error: "missing_user_id_or_guild_id" });
    return;
  }

  try {
    // Create audit log entry
    await (prisma as any).auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        guildId,
        action: "DATA_EXPORT_REQUESTED",
        resourceType: "USER_DATA",
        resourceId: userId,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      },
    });

    // Gather all user data
    const [tickets, events, transcripts, guildSettings] = await Promise.all([
      prisma.ticket.findMany({
        where: {
          guildId,
          $or: [{ ownerId: userId }, { claimedById: userId }],
        },
        include: { events: true, transcript: true },
      }),
      (prisma as any).ticketEvent.findMany({
        where: { actorId: userId },
      }),
      (prisma as any).ticketTranscript.findMany({
        where: {
          ticket: { guildId, ownerId: userId },
        },
      }),
      (prisma as any).guildSettings.findFirst({
        where: { guildId },
      }),
    ]);

    // Get session info
    const sessions = await (prisma as any).userConsent.findMany({
      where: { userId, guildId },
    });

    // Compile portable data
    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      guildId,
      userData: {
        username: req.session.user?.username,
        discriminator: req.session.user?.discriminator,
        avatar: req.session.user?.avatar,
      },
      ticketsOwned: tickets.filter((t) => t.ownerId === userId),
      ticketsClaimed: tickets.filter((t) => t.claimedById === userId),
      ticketEvents: events,
      transcripts,
      consents: sessions,
      dataRetention: {
        activeTickets: "Duration of ticket lifecycle",
        closedTickets: "24 months from closure",
        operationalLogs: "90 days",
        sessions: "Until expiration or logout",
      },
    };

    // Log completion
    await (prisma as any).auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        guildId,
        action: "DATA_EXPORT_COMPLETED",
        resourceType: "USER_DATA",
        resourceId: userId,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      },
    });

    res.json(exportData);
  } catch (error) {
    console.error("[gdpr] Data export failed:", error);
    res.status(500).json({ error: "export_failed" });
  }
});

/**
 * POST /api/gdpr/delete-request
 * Request account deletion (Article 17 - Right to Erasure)
 * Requires superuser confirmation
 */
gdprRouter.post("/delete-request", requireSession, async (req, res) => {
  const userId = req.session.user?.id;
  const guildId = String(req.headers["x-guild-id"] || "");

  if (!userId || !guildId) {
    res.status(400).json({ error: "missing_user_id_or_guild_id" });
    return;
  }

  try {
    // Create deletion request
    const deletionRequest = await (prisma as any).dataDeletionRequest.create({
      data: {
        id: uuidv4(),
        userId,
        guildId,
        status: "pending",
        reason: String(req.body.reason || "User requested deletion"),
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      },
    });

    // Log deletion request
    await (prisma as any).auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        guildId,
        action: "DELETION_REQUEST_CREATED",
        resourceType: "DELETION_REQUEST",
        resourceId: deletionRequest.id,
        details: { reason: req.body.reason || "User requested deletion" },
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      },
    });

    res.json({
      status: "pending",
      requestId: deletionRequest.id,
      message: "Deletion request created. Please contact support to confirm.",
      supportEmail: process.env.SUPPORT_EMAIL || "legal@m4rv1n.dev",
    });
  } catch (error) {
    console.error("[gdpr] Deletion request failed:", error);
    res.status(500).json({ error: "deletion_request_failed" });
  }
});

/**
 * POST /api/gdpr/delete-confirm
 * Confirm and execute user deletion (Superuser only)
 */
gdprRouter.post("/delete-confirm", requireSession, async (req, res) => {
  const userId = String(req.body.userId || "");
  const guildId = String(req.headers["x-guild-id"] || "");
  const requestId = String(req.body.requestId || "");
  const requesterUserId = req.session.user?.id;

  // Only superusers can confirm deletions
  if (!isConfiguredSuperuser(requesterUserId || "")) {
    res.status(403).json({ error: "superuser_access_required" });
    return;
  }

  if (!userId || !guildId || !requestId) {
    res.status(400).json({ error: "missing_required_fields" });
    return;
  }

  try {
    // Verify deletion request exists
    const deletionRequest = await (prisma as any).dataDeletionRequest.findUnique({
      where: { id: requestId },
    });

    if (!deletionRequest || deletionRequest.status !== "pending") {
      res.status(404).json({ error: "deletion_request_not_found_or_already_processed" });
      return;
    }

    // Delete all user data
    const [ticketsDeleted, eventsDeleted, transcriptsDeleted, consentsDeleted] = await Promise.all([
      prisma.ticket.deleteMany({
        where: {
          guildId,
          $or: [{ ownerId: userId }, { claimedById: userId }],
        },
      }),
      (prisma as any).ticketEvent.deleteMany({
        where: { actorId: userId },
      }),
      (prisma as any).ticketTranscript.deleteMany({
        where: {
          ticket: { guildId, ownerId: userId },
        },
      }),
      (prisma as any).userConsent.deleteMany({
        where: { userId, guildId },
      }),
    ]);

    // Mark deletion request as completed
    await (prisma as any).dataDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });

    // Log deletion completion
    await (prisma as any).auditLog.create({
      data: {
        id: uuidv4(),
        userId: requesterUserId,
        guildId,
        action: "USER_DATA_DELETED",
        resourceType: "USER_DATA",
        resourceId: userId,
        details: {
          ticketsDeleted: ticketsDeleted.count || 0,
          eventsDeleted: eventsDeleted.count || 0,
          transcriptsDeleted: transcriptsDeleted.count || 0,
          consentsDeleted: consentsDeleted.count || 0,
          deletionRequestId: requestId,
        },
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      },
    });

    res.json({
      status: "completed",
      message: "User data successfully deleted",
      deletedItems: {
        tickets: ticketsDeleted.count || 0,
        events: eventsDeleted.count || 0,
        transcripts: transcriptsDeleted.count || 0,
        consents: consentsDeleted.count || 0,
      },
    });
  } catch (error) {
    console.error("[gdpr] Deletion confirmation failed:", error);

    // Log failure
    await (prisma as any).auditLog.create({
      data: {
        id: uuidv4(),
        userId: requesterUserId,
        guildId,
        action: "USER_DATA_DELETION_FAILED",
        resourceType: "USER_DATA",
        resourceId: userId,
        details: { error: error instanceof Error ? error.message : "unknown_error" },
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      },
    });

    res.status(500).json({ error: "deletion_failed" });
  }
});

/**
 * GET /api/gdpr/audit-log
 * View audit log entries for user (Superuser only)
 */
gdprRouter.get("/audit-log", requireSession, async (req, res) => {
  const requesterUserId = req.session.user?.id;
  const userId = String(req.query.userId || "");
  const guildId = String(req.headers["x-guild-id"] || "");
  const limit = Math.min(parseInt(String(req.query.limit || "100")), 1000);

  // Only superusers can view audit logs
  if (!isConfiguredSuperuser(requesterUserId || "")) {
    res.status(403).json({ error: "superuser_access_required" });
    return;
  }

  try {
    const auditLogs = await (prisma as any).auditLog.findMany({
      where: {
        guildId,
        ...(userId && { userId }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json({ auditLogs });
  } catch (error) {
    console.error("[gdpr] Audit log retrieval failed:", error);
    res.status(500).json({ error: "audit_log_retrieval_failed" });
  }
});

/**
 * GET /api/gdpr/consent-status
 * Check user's consent status for data processing
 */
gdprRouter.get("/consent-status", requireSession, async (req, res) => {
  const userId = req.session.user?.id;
  const guildId = String(req.headers["x-guild-id"] || "");

  if (!userId || !guildId) {
    res.status(400).json({ error: "missing_user_id_or_guild_id" });
    return;
  }

  try {
    const consents = await (prisma as any).userConsent.findMany({
      where: { userId, guildId },
    });

    res.json({
      userId,
      guildId,
      consents: consents || [],
      defaultProcessingBasis: [
        { basis: "contract", description: "Necessary for service provision" },
        { basis: "legal_obligation", description: "Compliance with regulations" },
        { basis: "legitimate_interests", description: "System administration and security" },
      ],
    });
  } catch (error) {
    console.error("[gdpr] Consent status retrieval failed:", error);
    res.status(500).json({ error: "consent_status_retrieval_failed" });
  }
});

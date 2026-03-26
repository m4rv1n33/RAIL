import { prisma } from "@ukrrp/db";
import { v4 as uuidv4 } from "uuid";

/**
 * Data Retention Service
 * Implements GDPR compliance with automated data retention and deletion
 */

export const DATA_RETENTION_POLICIES = {
  closedTickets: 86400000 * 30 * 24, // 24 months in milliseconds
  operationalLogs: 86400000 * 90, // 90 days
  sessions: 86400000, // 1 day (invalidated on logout)
} as const;

/**
 * Delete closed tickets older than retention period
 * (Article 5 GDPR: Storage Limitation - data kept no longer than necessary)
 */
export const deleteExpiredClosedTickets = async (): Promise<{
  deletedCount: number;
  error?: string;
}> => {
  try {
    const retentionThresholdMs = DATA_RETENTION_POLICIES.closedTickets;
    const thresholdDate = new Date(Date.now() - retentionThresholdMs);

    const result = await prisma.ticket.deleteMany({
      where: {
        status: "closed",
        closedAt: {
          lt: thresholdDate,
        },
      },
    });

    await logRetentionAction("CLOSED_TICKETS_DELETED", (result as any).count || 0, {
      thresholdDate: thresholdDate.toISOString(),
      retentionDays: 720, // 24 months
    });

    return { deletedCount: (result as any).count || 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[retention] Failed to delete expired closed tickets:", message);
    await logRetentionAction("CLOSED_TICKETS_DELETION_FAILED", 0, { error: message });
    return { deletedCount: 0, error: message };
  }
};

/**
 * Delete orphaned transcripts (from deleted tickets)
 */
export const deleteOrphanedTranscripts = async (): Promise<{
  deletedCount: number;
  error?: string;
}> => {
  try {
    // Find transcripts where the associated ticket has been deleted
    const orphanedTranscripts = await (prisma as any).ticketTranscript.findMany({
      where: {
        ticket: null,
      },
    });

    const result = await (prisma as any).ticketTranscript.deleteMany({
      where: {
        id: {
          in: orphanedTranscripts.map((t: any) => t.id),
        },
      },
    });

    await logRetentionAction("ORPHANED_TRANSCRIPTS_DELETED", (result as any).count || 0);

    return { deletedCount: (result as any).count || 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[retention] Failed to delete orphaned transcripts:", message);
    await logRetentionAction("ORPHANED_TRANSCRIPTS_DELETION_FAILED", 0, { error: message });
    return { deletedCount: 0, error: message };
  }
};

/**
 * Soft-delete user data on account deletion request approval
 * (Article 17 GDPR: Right to Erasure - "right to be forgotten")
 */
export const softDeleteUserData = async (
  userId: string,
  guildId: string
): Promise<{
  success: boolean;
  deletedItemCount: number;
  error?: string;
}> => {
  try {
    const deletionTimestamp = new Date();

    // Mark user tickets as deleted
    const ticketsDeleted = await prisma.ticket.updateMany({
      where: {
        guildId,
        $or: [{ ownerId: userId }, { claimedById: userId }],
      },
      data: {
        deletedAt: deletionTimestamp,
      },
    });

    // Mark user transcripts as deleted
    const transcriptsDeleted = await (prisma as any).ticketTranscript.updateMany({
      where: {
        ticket: {
          guildId,
          ownerId: userId,
        },
      },
      data: {
        deletedAt: deletionTimestamp,
      },
    });

    // Delete user events
    const eventsDeleted = await (prisma as any).ticketEvent.deleteMany({
      where: {
        actorId: userId,
      },
    });

    // Delete user consents
    const consentsDeleted = await (prisma as any).userConsent.deleteMany({
      where: {
        userId,
        guildId,
      },
    });

    const totalDeleted =
      ((ticketsDeleted as any).count || 0) +
      ((transcriptsDeleted as any).count || 0) +
      ((eventsDeleted as any).count || 0) +
      ((consentsDeleted as any).count || 0);

    await logRetentionAction("USER_DATA_SOFT_DELETE", totalDeleted, {
      userId,
      guildId,
      ticketsDeleted: (ticketsDeleted as any).count || 0,
      transcriptsDeleted: (transcriptsDeleted as any).count || 0,
      eventsDeleted: (eventsDeleted as any).count || 0,
      consentsDeleted: (consentsDeleted as any).count || 0,
    });

    return { success: true, deletedItemCount: totalDeleted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[retention] Failed to soft-delete user data:", message);
    await logRetentionAction("USER_DATA_SOFT_DELETE_FAILED", 0, {
      userId,
      guildId,
      error: message,
    });
    return { success: false, deletedItemCount: 0, error: message };
  }
};

/**
 * Anonymize user data instead of full deletion
 * (Balances GDPR requirements with operational needs)
 */
export const anonymizeUserData = async (
  userId: string,
  guildId: string
): Promise<{
  success: boolean;
  anonymizedItemCount: number;
  error?: string;
}> => {
  try {
    const anonymousId = `anon_${uuidv4()}`;

    // Anonymize user events
    const eventsAnonymized = await (prisma as any).ticketEvent.updateMany({
      where: {
        actorId: userId,
      },
      data: {
        actorId: anonymousId,
      },
    });

    const totalAnonymized = ((eventsAnonymized as any).count || 0);

    await logRetentionAction("USER_DATA_ANONYMIZED", totalAnonymized, {
      userId,
      guildId,
      anonymousId,
      eventsAnonymized: (eventsAnonymized as any).count || 0,
    });

    return { success: true, anonymizedItemCount: totalAnonymized };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[retention] Failed to anonymize user data:", message);
    await logRetentionAction("USER_DATA_ANONYMIZATION_FAILED", 0, {
      userId,
      guildId,
      error: message,
    });
    return { success: false, anonymizedItemCount: 0, error: message };
  }
};

/**
 * Check if data deletion request is due for processing
 * (30 days after request made, per GDPR requirements)
 */
export const getDueForProcessingDeletionRequests = async (daysToWait: number = 30) => {
  try {
    const thresholdDate = new Date(Date.now() - daysToWait * 24 * 60 * 60 * 1000);

    const dueRequests = await (prisma as any).dataDeletionRequest.findMany({
      where: {
        status: "pending",
        requestedAt: {
          lte: thresholdDate,
        },
      },
    });

    return dueRequests;
  } catch (error) {
    console.error("[retention] Failed to get due deletion requests:", error);
    return [];
  }
};

/**
 * Log retention actions for audit trail
 */
async function logRetentionAction(
  action: string,
  itemCount: number,
  details?: Record<string, any>
): Promise<void> {
  try {
    await (prisma as any).auditLog.create({
      data: {
        id: uuidv4(),
        action: `RETENTION_${action}`,
        resourceType: "DATA_RETENTION",
        details: {
          ...details,
          itemCount,
          executedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[retention] Failed to log retention action:", error);
    // Don't rethrow - retention shouldn't fail if logging fails
  }
}

/**
 * Run full retention cleanup cycle
 * Should be called periodically (e.g., daily via cron job)
 */
export const runRetentionCleanup = async (): Promise<{
  success: boolean;
  results: Record<string, any>;
  error?: string;
}> => {
  console.info("[retention] Starting data retention cleanup cycle");

  try {
    const results = {
      expiredClosedTickets: await deleteExpiredClosedTickets(),
      orphanedTranscripts: await deleteOrphanedTranscripts(),
      timestamp: new Date().toISOString(),
    };

    const totalDeleted =
      (results.expiredClosedTickets?.deletedCount || 0) +
      (results.orphanedTranscripts?.deletedCount || 0);

    console.info(`[retention] Cleanup cycle complete: ${totalDeleted} items deleted`, results);

    return { success: true, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[retention] Retention cleanup cycle failed:", message);
    return { success: false, results: {}, error: message };
  }
};

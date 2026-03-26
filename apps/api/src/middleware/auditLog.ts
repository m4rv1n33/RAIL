import { Request, Response, NextFunction } from "express";
import { prisma } from "@ukrrp/db";
import { v4 as uuidv4 } from "uuid";

/**
 * Audit Logging Middleware
 * Tracks data processing activities for GDPR Article 5(1)(f) accountability
 * Logs: Access, Modification, Deletion of personal data
 */

interface AuditContext {
  userId?: string;
  guildId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, any>;
}

const getClientIp = (req: Request): string => {
  return (
    (req.headers["cf-connecting-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
    req.socket.remoteAddress ||
    "unknown"
  );
};

const getUserAgent = (req: Request): string => {
  return (req.headers["user-agent"] || "unknown") as string;
};

/**
 * Create audit log entry
 * Non-blocking: logs asynchronously to avoid impacting request latency
 */
export const auditLog = async (req: Request, context: AuditContext): Promise<void> => {
  // Non-blocking - execute without waiting
  setImmediate(async () => {
    try {
      await (prisma as any).auditLog.create({
        data: {
          id: uuidv4(),
          userId: context.userId || req.session.user?.id,
          guildId: context.guildId || (req.headers["x-guild-id"] as string),
          action: context.action,
          resourceType: context.resourceType,
          resourceId: context.resourceId,
          details: context.details,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
          createdAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[audit] Failed to log action:", {
        action: context.action,
        error: error instanceof Error ? error.message : "unknown",
      });
      // Don't throw - audit failures shouldn't break application
    }
  });
};

/**
 * Audit middleware factory
 * Wraps route handlers to automatically log data access/modification
 */
export const auditMiddleware = (
  resourceType: string,
  action: string,
  getResourceId?: (req: Request) => string | undefined
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Attach audit helper to request
    (req as any).auditLog = async (details?: Record<string, any>) => {
      await auditLog(req, {
        action,
        resourceType,
        resourceId: getResourceId?.(req),
        details,
      });
    };
    next();
  };
};

/**
 * Log data access (e.g., viewing transcripts)
 */
export const logDataAccess = async (
  req: Request,
  resourceType: string,
  resourceId: string,
  details?: Record<string, any>
): Promise<void> => {
  await auditLog(req, {
    action: "DATA_ACCESS",
    resourceType,
    resourceId,
    details,
  });
};

/**
 * Log data modification (e.g., updating tickets)
 */
export const logDataModification = async (
  req: Request,
  resourceType: string,
  resourceId: string,
  changes: Record<string, any>
): Promise<void> => {
  await auditLog(req, {
    action: "DATA_MODIFICATION",
    resourceType,
    resourceId,
    details: { changes },
  });
};

/**
 * Log data deletion
 */
export const logDataDeletion = async (
  req: Request,
  resourceType: string,
  resourceId: string,
  reason?: string
): Promise<void> => {
  await auditLog(req, {
    action: "DATA_DELETION",
    resourceType,
    resourceId,
    details: { reason },
  });
};

/**
 * Log authentication events
 */
export const logAuthEvent = async (
  req: Request,
  eventType: "LOGIN" | "LOGOUT" | "FAILED_AUTH" | "CONSENT_GRANT" | "CONSENT_REVOKE",
  details?: Record<string, any>
): Promise<void> => {
  await auditLog(req, {
    action: `AUTH_${eventType}`,
    resourceType: "AUTHENTICATION",
    details,
  });
};

/**
 * Retrieve audit logs (filtered and paginated)
 * Only superusers should access this
 */
export const getAuditLogs = async (
  filters: {
    userId?: string;
    guildId?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}
) => {
  try {
    const {
      userId,
      guildId,
      action,
      resourceType,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = filters;

    const where: any = {};

    if (userId) where.userId = userId;
    if (guildId) where.guildId = guildId;
    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [logs, total] = await Promise.all([
      (prisma as any).auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 1000),
        skip: offset,
      }),
      (prisma as any).auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  } catch (error) {
    console.error("[audit] Failed to retrieve audit logs:", error);
    throw error;
  }
};

/**
 * Export audit logs for compliance verification
 * Used for regulatory requests and compliance audits
 */
export const exportAuditLogs = async (filters: {
  startDate: Date;
  endDate: Date;
  guildId?: string;
}): Promise<string> => {
  try {
    const logs = await (prisma as any).auditLog.findMany({
      where: {
        createdAt: {
          gte: filters.startDate,
          lte: filters.endDate,
        },
        ...(filters.guildId && { guildId: filters.guildId }),
      },
      orderBy: { createdAt: "asc" },
    });

    // Convert to CSV format for export
    const headers = ["Timestamp", "User ID", "Guild ID", "Action", "Resource Type", "Resource ID", "IP Address", "Details"];
    const rows = logs.map((log: any) => [
      log.createdAt.toISOString(),
      log.userId || "system",
      log.guildId || "N/A",
      log.action,
      log.resourceType,
      log.resourceId || "N/A",
      log.ipAddress,
      JSON.stringify(log.details || {}),
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row: string[]) => row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    return csv;
  } catch (error) {
    console.error("[audit] Failed to export audit logs:", error);
    throw error;
  }
};

/**
 * Auto-purge old audit logs (older than retention period)
 * GDPR Article 5(1)(e) - Storage Limitation
 */
export const purgeOldAuditLogs = async (retentionDays: number = 90): Promise<number> => {
  try {
    const thresholdDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await (prisma as any).auditLog.deleteMany({
      where: {
        createdAt: {
          lt: thresholdDate,
        },
      },
    });

    console.info(`[audit] Purged ${result.count || 0} old audit logs (retention: ${retentionDays} days)`);

    return result.count || 0;
  } catch (error) {
    console.error("[audit] Failed to purge old audit logs:", error);
    return 0;
  }
};

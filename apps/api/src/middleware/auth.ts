import type { Request, Response, NextFunction } from "express";
import { fetchCurrentUserGuild, fetchCurrentUserGuildMember, fetchGuildMember } from "../services/discord.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";
import { restoreSessionUserFromAuthCookie, restoreSessionUserFromAuthHeader } from "../utils/authCookie.js";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      username: string;
      discriminator: string;
      avatar: string | null;
      accessToken: string;
    };
  }
}

export const requireSession = (req: Request, res: Response, next: NextFunction) => {
  restoreSessionUserFromAuthCookie(req);
  restoreSessionUserFromAuthHeader(req);
  if (!req.session.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};

const STAFF_TRANSCRIPTS_ROLE_ID = "1406675931589902466";
const MANAGEMENT_ROLE_IDS = new Set<string>(["1407413756971188346", "1469431145161818123"]);
const ADMIN_PERMISSION = 0x8n;

type AccessEvaluation = {
  isSuperuser: boolean;
  isAdmin: boolean;
  hasStaffRole: boolean;
  hasManagementRole: boolean;
};

const hasOAuthAdminPermission = async (res: Response, userAccessToken: string, guildId: string) => {
  try {
    const guild = (await fetchCurrentUserGuild(userAccessToken, guildId)) as
      | { permissions?: string; permissions_new?: string }
      | null;
    const permissionsRaw = guild?.permissions_new || guild?.permissions || "0";
    const permissions = BigInt(permissionsRaw);
    return (permissions & ADMIN_PERMISSION) === ADMIN_PERMISSION;
  } catch (error) {
    const message = error instanceof Error ? error.message : "discord_user_guild_lookup_failed";
    if (message === "user_token_invalid") {
      res.status(401).json({ error: "reauth_required" });
      return null;
    }
    return false;
  }
};

export const evaluateAccess = async (req: Request, res: Response): Promise<AccessEvaluation | null> => {
  const user = restoreSessionUserFromAuthCookie(req) || restoreSessionUserFromAuthHeader(req) || req.session.user;
  const guildId = String(req.headers["x-guild-id"] || "");

  if (!user || !guildId) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  const isSuperuser = isConfiguredSuperuser(user.id);
  if (isSuperuser) {
    return {
      isSuperuser: true,
      isAdmin: true,
      hasStaffRole: true,
      hasManagementRole: true
    };
  }

  const oauthAdmin = await hasOAuthAdminPermission(res, user.accessToken, guildId);
  if (oauthAdmin === null) {
    return null;
  }

  let member: { roles: string[] } | null = null;
  try {
    member = await fetchGuildMember(guildId, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "discord_member_lookup_failed";
    try {
      member = await fetchCurrentUserGuildMember(user.accessToken, guildId);
    } catch (oauthError) {
      const oauthMessage = oauthError instanceof Error ? oauthError.message : "discord_user_member_lookup_failed";
      if (oauthMessage === "user_token_invalid" || oauthMessage === "oauth_scope_missing") {
        res.status(401).json({ error: "reauth_required" });
        return null;
      }
      if (message === "bot_token_missing" || message === "bot_auth_failed" || message === "bot_missing_access") {
        if (oauthAdmin) {
          return {
            isSuperuser: false,
            isAdmin: true,
            hasStaffRole: false,
            hasManagementRole: false
          };
        }
        res.status(500).json({ error: "discord_lookup_unavailable" });
        return null;
      }
      if (oauthAdmin) {
        return {
          isSuperuser: false,
          isAdmin: true,
          hasStaffRole: false,
          hasManagementRole: false
        };
      }
      res.status(502).json({ error: "discord_lookup_failed" });
      return null;
    }
  }

  if (!member) {
    res.status(403).json({ error: "not_in_guild" });
    return null;
  }

  const memberRoleSet = new Set(member.roles || []);
  return {
    isSuperuser: false,
    isAdmin: oauthAdmin,
    hasStaffRole: memberRoleSet.has(STAFF_TRANSCRIPTS_ROLE_ID),
    hasManagementRole: [...MANAGEMENT_ROLE_IDS].some((roleId) => memberRoleSet.has(roleId))
  };
};

export const requireDashboardAccess = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.session.user;
  const guildId = String(req.headers["x-guild-id"] || "");
  if (!user || !guildId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const access = await evaluateAccess(req, res);
  if (!access) {
    return;
  }

  const allowed = access.isSuperuser || access.isAdmin || access.hasManagementRole || access.hasStaffRole;
  if (!allowed) {
    res.status(403).json({ error: "staff_required" });
    return;
  }
  next();
};

export const requireManagementAccess = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.session.user;
  const guildId = String(req.headers["x-guild-id"] || "");
  if (!user || !guildId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const access = await evaluateAccess(req, res);
  if (!access) {
    return;
  }

  if (access.isSuperuser) {
    console.warn(
      [
        "⚠️ SuperUser bypass detected",
        `action=api.requireManagementAccess`,
        `by=${user.username} (${user.id})`,
        `when=${new Date().toISOString()}`,
        `guild=${guildId}`,
        `method=${req.method}`,
        `path=${req.originalUrl}`,
        "details=Management restriction bypassed"
      ].join(" | ")
    );
    next();
    return;
  }

  const allowed = access.isAdmin || access.hasManagementRole;
  if (!allowed) {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  next();
};

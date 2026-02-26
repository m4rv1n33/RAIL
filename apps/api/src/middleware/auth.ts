import type { Request, Response, NextFunction } from "express";
import { fetchCurrentUserGuild, fetchCurrentUserGuildMember, fetchGuildMember, fetchGuildRoles } from "../services/discord.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";

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
  if (!req.session.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};

export const requireStaff = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.session.user;
  const guildId = String(req.headers["x-guild-id"] || "");
  const ADMIN_PERMISSION = 0x8n;

  const hasOAuthAdminPermission = async () => {
    try {
      const guild = await fetchCurrentUserGuild(user!.accessToken, guildId) as { permissions?: string; permissions_new?: string } | null;
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

  if (!user || !guildId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (isConfiguredSuperuser(user.id)) {
    console.warn(
      [
        "⚠️ SuperUser bypass detected",
        `action=api.requireStaff`,
        `by=${user.username} (${user.id})`,
        `when=${new Date().toISOString()}`,
        `guild=${guildId}`,
        `method=${req.method}`,
        `path=${req.originalUrl}`,
        "details=Admin/staff restriction bypassed"
      ].join(" | ")
    );
    next();
    return;
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
      if (oauthMessage === "user_token_invalid") {
        res.status(401).json({ error: "reauth_required" });
        return;
      }
      if (oauthMessage === "oauth_scope_missing") {
        res.status(401).json({ error: "reauth_required" });
        return;
      }
      if (
        message === "bot_token_missing" ||
        message === "bot_auth_failed" ||
        message === "bot_missing_access"
      ) {
        const oauthAdmin = await hasOAuthAdminPermission();
        if (oauthAdmin === null) {
          return;
        }
        if (oauthAdmin) {
          next();
          return;
        }
        res.status(500).json({ error: "discord_lookup_unavailable" });
        return;
      }
      const oauthAdmin = await hasOAuthAdminPermission();
      if (oauthAdmin === null) {
        return;
      }
      if (oauthAdmin) {
        next();
        return;
      }
      res.status(502).json({ error: "discord_lookup_failed" });
      return;
    }
  }
  if (!member) {
    res.status(403).json({ error: "not_in_guild" });
    return;
  }

  const oauthAdmin = await hasOAuthAdminPermission();
  if (oauthAdmin === null) {
    return;
  }
  let isAdmin = oauthAdmin;

  if (!isAdmin) {
    try {
      const roles = await fetchGuildRoles(guildId);
      const roleIds = new Set<string>([...member.roles, guildId]);
      const aggregatePermissions = roles
        .filter((role) => roleIds.has(role.id))
        .reduce((acc, role) => acc | BigInt(role.permissions || "0"), 0n);
      isAdmin = (aggregatePermissions & ADMIN_PERMISSION) === ADMIN_PERMISSION;
    } catch {
      res.status(502).json({ error: "discord_lookup_failed" });
      return;
    }
  }

  if (!isAdmin) {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  next();
};

import type { Request, Response, NextFunction } from "express";
import { fetchCurrentUserGuild, fetchCurrentUserGuildMember, fetchGuildMember, fetchGuildRoles } from "../services/discord.js";

const BYPASS_USER_ID = process.env.DEV_BYPASS_USER_ID || "";

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
  if (!user || !guildId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (user.id === BYPASS_USER_ID) {
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
        res.status(500).json({ error: "discord_lookup_unavailable" });
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

  const ADMIN_PERMISSION = 0x8n;
  let isAdmin = false;

  try {
    const guild = await fetchCurrentUserGuild(user.accessToken, guildId);
    const permissions = BigInt(guild?.permissions || "0");
    if ((permissions & ADMIN_PERMISSION) === ADMIN_PERMISSION) {
      isAdmin = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "discord_user_guild_lookup_failed";
    if (message === "user_token_invalid") {
      res.status(401).json({ error: "reauth_required" });
      return;
    }
  }

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

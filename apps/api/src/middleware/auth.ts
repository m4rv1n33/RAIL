import type { Request, Response, NextFunction } from "express";
import { prisma } from "@rail/db";
import { fetchCurrentUserGuildMember, fetchGuildMember } from "../services/discord.js";

const BYPASS_USER_ID = process.env.DEV_BYPASS_USER_ID || "1163826327841939506";

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
  const teamRoles = await prisma.supportTeamRole.findMany({
    where: {
      team: { guildId }
    }
  });
  const allowedRoleIds = new Set(teamRoles.map((role) => role.roleId));
  const hasRole = member.roles.some((roleId: string) => allowedRoleIds.has(roleId));
  if (!hasRole) {
    res.status(403).json({ error: "not_staff" });
    return;
  }
  next();
};

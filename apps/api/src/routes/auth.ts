import { Router } from "express";
import { exchangeCode, fetchDiscordUser } from "../services/discord.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";
import { evaluateAccess } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || "",
    redirect_uri: process.env.DISCORD_REDIRECT_URI || "",
    response_type: "code",
    scope: "identify guilds guilds.members.read"
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

authRouter.get("/callback", async (req, res) => {
  const code = String(req.query.code || "");
  if (!code) {
    res.status(400).json({ error: "missing_code" });
    return;
  }
  const token = await exchangeCode(code);
  const user = await fetchDiscordUser(token.access_token);
  req.session.user = {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar,
    accessToken: token.access_token
  };
  req.session.save((error) => {
    if (error) {
      console.error("[auth] Failed to persist session during OAuth callback", error);
      res.status(500).json({ error: "session_save_failed" });
      return;
    }
    res.redirect(process.env.DASHBOARD_ORIGIN || "/");
  });
});

authRouter.get("/me", async (req, res) => {
  const user = req.session.user || null;
  if (!user) {
    res.json({ user: null });
    return;
  }

  let canAccessDashboard = false;
  let canManage = false;
  const guildId = String(req.headers["x-guild-id"] || "");
  if (guildId) {
    const access = await evaluateAccess(req, res);
    if (!access) {
      return;
    }
    canAccessDashboard = access.isSuperuser || access.isAdmin || access.hasManagementRole || access.hasStaffRole;
    canManage = access.isSuperuser || access.isAdmin || access.hasManagementRole;
  }

  res.json({
    user: {
      ...user,
      isSuperuser: isConfiguredSuperuser(user.id),
      canAccessDashboard,
      canManage
    }
  });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

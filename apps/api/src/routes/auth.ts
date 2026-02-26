import { Router } from "express";
import { exchangeCode, fetchDiscordUser } from "../services/discord.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";

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
  res.redirect(process.env.DASHBOARD_ORIGIN || "/");
});

authRouter.get("/me", (req, res) => {
  const user = req.session.user || null;
  res.json({
    user: user
      ? {
          ...user,
          isSuperuser: isConfiguredSuperuser(user.id)
        }
      : null
  });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

import { Router } from "express";
import { exchangeCode, fetchDiscordUser } from "../services/discord.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";
import { evaluateAccess } from "../middleware/auth.js";
import {
  clearAuthCookie,
  createAuthToken,
  restoreSessionUserFromAuthCookie,
  restoreSessionUserFromAuthHeader,
  setAuthCookie
} from "../utils/authCookie.js";

export const authRouter = Router();

authRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Vary", "Cookie");
  next();
});

const normalizeOrigin = (value: string) => value.trim().replace(/\/$/, "");

const getAllowedDashboardOrigins = () => {
  const primary = normalizeOrigin(String(process.env.DASHBOARD_ORIGIN || ""));
  const extras = String(process.env.DASHBOARD_ORIGINS || "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  return new Set([primary, ...extras].filter(Boolean));
};

const sanitizeReturnTo = (candidate: string) => {
  if (!candidate) {
    return "";
  }
  try {
    const parsed = new URL(candidate);
    const normalizedOrigin = normalizeOrigin(parsed.origin);
    const allowedOrigins = getAllowedDashboardOrigins();
    if (!allowedOrigins.has(normalizedOrigin)) {
      return "";
    }
    return `${normalizedOrigin}${parsed.pathname || "/"}`;
  } catch {
    return "";
  }
};

authRouter.get("/login", (req, res) => {
  const requestedReturnTo = sanitizeReturnTo(String(req.query.return_to || ""));
  const fallbackReturnTo = sanitizeReturnTo(String(process.env.DASHBOARD_ORIGIN || ""));
  const returnTo = requestedReturnTo || fallbackReturnTo || "/";
  const statePayload = JSON.stringify({ returnTo });
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || "",
    redirect_uri: process.env.DISCORD_REDIRECT_URI || "",
    response_type: "code",
    scope: "identify guilds guilds.members.read",
    state: Buffer.from(statePayload, "utf-8").toString("base64url")
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

authRouter.get("/callback", async (req, res) => {
  const code = String(req.query.code || "");
  if (!code) {
    res.status(400).json({ error: "missing_code" });
    return;
  }
  const stateValue = String(req.query.state || "");
  let returnTo = sanitizeReturnTo(String(process.env.DASHBOARD_ORIGIN || "")) || "/";
  if (stateValue) {
    try {
      const decoded = Buffer.from(stateValue, "base64url").toString("utf-8");
      const parsed = JSON.parse(decoded) as { returnTo?: unknown };
      if (typeof parsed.returnTo === "string") {
        const stateReturnTo = sanitizeReturnTo(parsed.returnTo);
        if (stateReturnTo) {
          returnTo = stateReturnTo;
        }
      }
    } catch {
      // Ignore malformed state and fall back to configured origin.
    }
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
    const persistedUser = req.session.user!;
    setAuthCookie(res, persistedUser);
    const authToken = createAuthToken(persistedUser);
    const redirectTarget = returnTo;
    const escapedRedirectTarget = redirectTarget.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const scriptRedirectBase = JSON.stringify(redirectTarget);
    const scriptAuthToken = JSON.stringify(authToken);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Login Complete</title>
  </head>
  <body style="font-family: sans-serif; padding: 20px;">
    <p>Login complete. Redirecting back to dashboard...</p>
    <p><a href="${escapedRedirectTarget}">Continue</a></p>
    <script>
      (function () {
        var base = ${scriptRedirectBase};
        var token = ${scriptAuthToken};
        try {
          var target = new URL(base, window.location.origin);
          target.hash = "auth_token=" + encodeURIComponent(token);
          setTimeout(function () {
            window.location.replace(target.toString());
          }, 150);
          return;
        } catch (_) {
          // Fall back to direct redirect below.
        }
      })();
      setTimeout(function () {
        window.location.replace(${scriptRedirectBase});
      }, 150);
    </script>
  </body>
</html>`);
  });
});

authRouter.get("/me", async (req, res) => {
  const user = restoreSessionUserFromAuthCookie(req) || restoreSessionUserFromAuthHeader(req) || null;
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
    clearAuthCookie(res);
    res.json({ ok: true });
  });
});

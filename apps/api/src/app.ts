import express from "express";
import cors from "cors";
import session from "express-session";
import { authRouter } from "./routes/auth.js";
import { panelsRouter } from "./routes/panels.js";
import { categoriesRouter } from "./routes/categories.js";
import { teamsRouter } from "./routes/teams.js";
import { settingsRouter } from "./routes/settings.js";
import { discordRouter } from "./routes/discord.js";
import { transcriptsRouter } from "./routes/transcripts.js";

export const createApp = () => {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";
  const sessionSecret = String(process.env.SESSION_SECRET || "ukrrp-dev-session-secret");
  const dashboardOrigin = String(process.env.DASHBOARD_ORIGIN || "");
  const dashboardOverHttps = dashboardOrigin.startsWith("https://");
  const forceSecureCookie = String(process.env.SESSION_COOKIE_SECURE || "").toLowerCase() === "true";
  const useSecureCookie = isProduction || dashboardOverHttps || forceSecureCookie;
  const sameSiteEnv = String(process.env.SESSION_COOKIE_SAMESITE || "").toLowerCase();
  const cookieSameSite =
    sameSiteEnv === "none" || sameSiteEnv === "lax" || sameSiteEnv === "strict"
      ? sameSiteEnv
      : useSecureCookie
        ? "none"
        : "lax";

  if (isProduction || useSecureCookie) {
    app.set("trust proxy", 1);
  }

  app.use(
    cors({
      origin: process.env.DASHBOARD_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    const cfRay = String(req.headers["cf-ray"] || "");
    const cfIp = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "");
    const userAgent = String(req.headers["user-agent"] || "");
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      console.info(
        `[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms) ip=${cfIp || "unknown"} cfRay=${cfRay || "none"} ua=${userAgent || "unknown"}`
      );
    });
    next();
  });
  app.use(
    session({
      secret: sessionSecret,
      proxy: useSecureCookie,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: cookieSameSite as "none" | "lax" | "strict",
        maxAge: 1000 * 60 * 60 * 8
      }
    })
  );

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "UKRRP Ticket System API" });
  });

  app.use("/auth", authRouter);
  app.use("/teams", teamsRouter);
  app.use("/categories", categoriesRouter);
  app.use("/panels", panelsRouter);
  app.use("/settings", settingsRouter);
  app.use("/discord", discordRouter);
  app.use("/transcripts", transcriptsRouter);

  return app;
};

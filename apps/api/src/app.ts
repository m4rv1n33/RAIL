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

  if (isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(
    cors({
      origin: process.env.DASHBOARD_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "change-me",
      proxy: isProduction,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
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

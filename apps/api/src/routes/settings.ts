import { Router } from "express";
import { z } from "zod";
import { requireSession, requireStaff } from "../middleware/auth.js";
import { getGuildSettings, setGuildSettings } from "../services/settings.js";

export const settingsRouter = Router();

const updateSchema = z.object({
  transcriptChannelId: z.string().optional().nullable()
});

settingsRouter.get("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const settings = await getGuildSettings(guildId);
  res.json({ settings });
});

settingsRouter.put("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const input = updateSchema.parse(req.body);
  const settings = await setGuildSettings(guildId, {
    transcriptChannelId: input.transcriptChannelId || undefined
  });
  res.json({ settings });
});

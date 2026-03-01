import { Router } from "express";
import { z } from "zod";
import { requireSession, requireStaff } from "../middleware/auth.js";
import { getGuildSettings, setGuildSettings } from "../services/settings.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";

export const settingsRouter = Router();

const updateSchema = z.object({
  transcriptChannelId: z.string().optional().nullable(),
  mediaForumChannelId: z.string().optional().nullable()
});

settingsRouter.get("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const settings = await getGuildSettings(guildId);
  res.json({ settings });
});

settingsRouter.put("/", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const input = updateSchema.parse(req.body);
  const userId = String(req.session.user?.id || "");
  const requestedMediaForumUpdate = Object.prototype.hasOwnProperty.call(req.body || {}, "mediaForumChannelId");

  if (requestedMediaForumUpdate && !isConfiguredSuperuser(userId)) {
    res.status(403).json({ error: "superuser_only" });
    return;
  }

  const settings = await setGuildSettings(guildId, {
    transcriptChannelId: input.transcriptChannelId || undefined,
    mediaForumChannelId: requestedMediaForumUpdate
      ? input.mediaForumChannelId || undefined
      : undefined
  });
  res.json({ settings });
});

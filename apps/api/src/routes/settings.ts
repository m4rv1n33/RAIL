import { Router } from "express";
import { z } from "zod";
import { requireManagementAccess, requireSession } from "../middleware/auth.js";
import { getGuildSettings, setGuildSettings } from "../services/settings.js";
import { isConfiguredSuperuser } from "../utils/superuser.js";

export const settingsRouter = Router();

const updateSchema = z.object({
  transcriptChannelId: z.string().optional().nullable(),
  mediaForumChannelId: z.string().optional().nullable()
});

settingsRouter.get("/", requireSession, requireManagementAccess, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const settings = await getGuildSettings(guildId);
  res.json({ settings });
});

settingsRouter.put("/", requireSession, requireManagementAccess, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  const input = updateSchema.parse(req.body);
  const userId = String(req.session.user?.id || "");
  const requestedTranscriptUpdate = Object.prototype.hasOwnProperty.call(req.body || {}, "transcriptChannelId");
  const requestedMediaForumUpdate = Object.prototype.hasOwnProperty.call(req.body || {}, "mediaForumChannelId");

  if (requestedMediaForumUpdate && !isConfiguredSuperuser(userId)) {
    res.status(403).json({ error: "superuser_only" });
    return;
  }

  const update: { transcriptChannelId?: string; mediaForumChannelId?: string } = {};
  if (requestedTranscriptUpdate) {
    update.transcriptChannelId = input.transcriptChannelId || undefined;
  }
  if (requestedMediaForumUpdate) {
    update.mediaForumChannelId = input.mediaForumChannelId || undefined;
  }

  const settings = await setGuildSettings(guildId, update);
  res.json({ settings });
});

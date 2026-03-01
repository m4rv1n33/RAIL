import { Router } from "express";
import { requireSession, requireStaff } from "../middleware/auth.js";
import { fetchGuildChannels, fetchGuildRoles } from "../services/discord.js";

export const discordRouter = Router();

const toDiscordColorHex = (color?: number) => {
  if (typeof color !== "number" || color <= 0) {
    return null;
  }
  return `#${color.toString(16).padStart(6, "0")}`;
};

discordRouter.get("/channels", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  if (!guildId) {
    res.status(400).json({ error: "guild_id_missing" });
    return;
  }
  try {
    const channels = await fetchGuildChannels(guildId);
    const normalized = channels
      .filter((channel) => [0, 4, 5].includes(channel.type))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parent_id || null
      }));
    res.json({ channels: normalized });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "bot_auth_failed") {
        res.status(500).json({ error: "bot_auth_failed" });
        return;
      }
      if (error.message === "bot_missing_access") {
        res.status(500).json({ error: "bot_missing_access" });
        return;
      }
      if (error.message === "bot_token_missing") {
        res.status(500).json({ error: "bot_auth_failed" });
        return;
      }
    }
    res.status(502).json({ error: "discord_channel_lookup_failed" });
  }
});

discordRouter.get("/roles", requireSession, requireStaff, async (req, res) => {
  const guildId = String(req.headers["x-guild-id"] || "");
  if (!guildId) {
    res.status(400).json({ error: "guild_id_missing" });
    return;
  }
  try {
    const roles = await fetchGuildRoles(guildId);
    const normalized = roles
      .filter((role) => role.id !== guildId)
      .sort((left, right) => right.position - left.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        position: role.position,
        managed: Boolean(role.managed),
        colorHex: toDiscordColorHex(role.color)
      }));
    res.json({ roles: normalized });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "bot_auth_failed") {
        res.status(500).json({ error: "bot_auth_failed" });
        return;
      }
      if (error.message === "bot_missing_access") {
        res.status(500).json({ error: "bot_missing_access" });
        return;
      }
      if (error.message === "bot_token_missing") {
        res.status(500).json({ error: "bot_auth_failed" });
        return;
      }
    }
    res.status(502).json({ error: "discord_role_lookup_failed" });
  }
});

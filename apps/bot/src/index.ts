import { config } from "dotenv";
import express from "express";
import {
  ActivityType,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuInteraction,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";
import { prisma } from "@ukrrp/db";
import { TicketStatus } from "@ukrrp/shared";
import { initDiscordLogRelay } from "./logRelay.js";

config({ path: new URL("../.env", import.meta.url) });
config();
initDiscordLogRelay("bot");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

const updateBotPresence = () => {
  if (!client.user) {
    return;
  }
  const totalMembers = client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0);
  client.user.setActivity(`over ${totalMembers.toLocaleString()} members`, {
    type: ActivityType.Watching
  });
};

client.once("ready", () => {
  updateBotPresence();
});

client.on("guildCreate", () => {
  updateBotPresence();
});

client.on("guildDelete", () => {
  updateBotPresence();
});

client.on("guildMemberAdd", () => {
  updateBotPresence();
});

client.on("guildMemberRemove", () => {
  updateBotPresence();
});

type ModalField = {
  id: string;
  label: string;
  style: "short" | "paragraph";
  required: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
};

type ModalSchema = {
  title: string;
  fields: ModalField[];
};

type SuperuserRecord = {
  user_id: string;
  username?: string;
  display_name?: string;
  designation?: string;
  role?: string;
  granted_at?: string;
};

const SUPERUSER_ROLE_PRIORITY: Record<string, number> = {
  owner: 0,
  admin: 1,
  maintainer: 2,
  operator: 3,
  support: 4
};

const getConfiguredSuperusers = (): SuperuserRecord[] => {
  const records: SuperuserRecord[] = [];
  const json = (process.env.SUPERUSERS_JSON || "").trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed)) {
        parsed.forEach((entry) => {
          if (!entry || typeof entry !== "object") {
            return;
          }
          const candidate = entry as {
            user_id?: unknown;
            display_name?: unknown;
            username?: unknown;
            designation?: unknown;
            superuser_type?: unknown;
            type?: unknown;
            role?: unknown;
            permission_level?: unknown;
            granted_at?: unknown;
          };
          if (typeof candidate.user_id !== "string" || !candidate.user_id.trim()) {
            return;
          }
          records.push({
            user_id: candidate.user_id.trim(),
            username: typeof candidate.username === "string" ? candidate.username.trim() : undefined,
            display_name:
              typeof candidate.display_name === "string" ? candidate.display_name.trim() : undefined,
            designation:
              typeof candidate.designation === "string"
                ? candidate.designation.trim()
                : typeof candidate.superuser_type === "string"
                  ? candidate.superuser_type.trim()
                  : typeof candidate.type === "string"
                    ? candidate.type.trim()
                    : undefined,
            role:
              typeof candidate.role === "string"
                ? candidate.role.trim()
                : typeof candidate.permission_level === "string"
                  ? candidate.permission_level.trim()
                  : undefined,
            granted_at: typeof candidate.granted_at === "string" ? candidate.granted_at.trim() : undefined
          });
        });
      }
    } catch {
      // Fall back to DEV_BYPASS_USER_ID-only mode.
    }
  }

  if (records.length === 0) {
    const fallbackIds = (process.env.DEV_BYPASS_USER_ID || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    fallbackIds.forEach((id) => records.push({ user_id: id, role: "admin" }));
  }

  const byId = new Map<string, SuperuserRecord>();
  records.forEach((record) => {
    if (!byId.has(record.user_id)) {
      byId.set(record.user_id, record);
    }
  });

  const normalized = [...byId.values()];
  normalized.sort((left, right) => {
    const leftPrimary = (left.designation || "").toLowerCase().includes("primary") ? 0 : 1;
    const rightPrimary = (right.designation || "").toLowerCase().includes("primary") ? 0 : 1;
    if (leftPrimary !== rightPrimary) {
      return leftPrimary - rightPrimary;
    }
    const leftRole = (left.role || "").toLowerCase();
    const rightRole = (right.role || "").toLowerCase();
    const leftPriority = SUPERUSER_ROLE_PRIORITY[leftRole] ?? 99;
    const rightPriority = SUPERUSER_ROLE_PRIORITY[rightRole] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftGranted = left.granted_at ? Date.parse(left.granted_at) : Number.POSITIVE_INFINITY;
    const rightGranted = right.granted_at ? Date.parse(right.granted_at) : Number.POSITIVE_INFINITY;
    if (leftGranted !== rightGranted) {
      return leftGranted - rightGranted;
    }
    return left.user_id.localeCompare(right.user_id);
  });

  return normalized;
};

const isConfiguredSuperuser = (userId: string, records: SuperuserRecord[]) =>
  records.some((record) => record.user_id === userId);

const toDiscordTimestamp = (value?: string) => {
  if (!value) {
    return null;
  }
  const unix = Math.floor(Date.parse(value) / 1000);
  if (!Number.isFinite(unix) || unix <= 0) {
    return null;
  }
  return `<t:${unix}:F>`;
};

const APP_NAME = "UKRRP Ticket System";
const BRAND_FOOTER = "Powered by RAIL, built by @m4rv1n_33";
const PRIMARY_EMBED_COLOR = "#1938b4";
const PANEL_TOP_BANNER_NAME = "top.png";
const PANEL_BOTTOM_BANNER_NAME = "bottom.png";
const TEAM_AUTOCOMPLETE_CACHE_TTL_MS = Number(process.env.TEAM_AUTOCOMPLETE_CACHE_TTL_MS || 30_000);
const ATTACHMENT_STORAGE_CACHE_TTL_MS = Number(process.env.ATTACHMENT_STORAGE_CACHE_TTL_MS || 30_000);
const HARDCODED_MEDIA_BACKUP_CHANNEL_ID = "1477791851242193051";

type AutocompleteTeam = { id: string; name: string };
const teamAutocompleteCache = new Map<string, { expiresAt: number; teams: AutocompleteTeam[] }>();
const attachmentArchiveChannelCache = new Map<string, { expiresAt: number; channelId: string }>();

type MediaPostLinkData = {
  threadId: string;
  forumChannelId: string;
  starterMessageId?: string;
};

const isPrismaPoolTimeout = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown };
  return candidate.code === "P2024";
};

const getTeamsForAutocomplete = async (guildId: string) => {
  const now = Date.now();
  const cached = teamAutocompleteCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached.teams;
  }

  try {
    const teams = await prisma.supportTeam.findMany({
      where: { guildId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 100
    });
    teamAutocompleteCache.set(guildId, {
      expiresAt: now + TEAM_AUTOCOMPLETE_CACHE_TTL_MS,
      teams
    });
    return teams;
  } catch (error) {
    if (isPrismaPoolTimeout(error) && cached?.teams?.length) {
      console.warn(
        `[autocomplete] Using stale support-team cache for guild ${guildId} due to Prisma pool timeout (P2024).`
      );
      return cached.teams;
    }
    throw error;
  }
};

const getSettingsFilePath = () => {
  const candidates = [
    path.resolve(process.cwd(), "data", "guild-settings.json"),
    path.resolve(process.cwd(), "..", "..", "data", "guild-settings.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
};

const getAssetFilePath = (fileName: string) => {
  const candidates = [
    path.resolve(process.cwd(), "assets", fileName),
    path.resolve(process.cwd(), "..", "..", "assets", fileName)
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`asset_not_found:${fileName}`);
  }
  return resolved;
};

const getTranscriptChannelIdForGuild = async (guildId: string) => {
  const settingsFilePath = getSettingsFilePath();
  try {
    const content = await fs.readFile(settingsFilePath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, { transcriptChannelId?: string }>;
    return parsed[guildId]?.transcriptChannelId || process.env.TRANSCRIPT_CHANNEL_ID || "";
  } catch {
    return process.env.TRANSCRIPT_CHANNEL_ID || "";
  }
};

const getMediaForumChannelIdForGuild = async (guildId: string) => {
  if (HARDCODED_MEDIA_BACKUP_CHANNEL_ID) {
    return HARDCODED_MEDIA_BACKUP_CHANNEL_ID;
  }

  const cached = attachmentArchiveChannelCache.get(guildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.channelId;
  }

  const settingsFilePath = getSettingsFilePath();
  let channelId = "";
  try {
    const content = await fs.readFile(settingsFilePath, "utf-8");
    const parsed = JSON.parse(content) as Record<
      string,
      {
        mediaForumChannelId?: string;
        attachmentForumChannelId?: string;
        attachmentArchiveChannelId?: string;
        mediaArchiveChannelId?: string;
        transcriptChannelId?: string;
      }
    >;
    const guildSettings = parsed[guildId] || {};
    channelId =
      guildSettings.mediaForumChannelId ||
      guildSettings.attachmentForumChannelId ||
      process.env.MEDIA_FORUM_CHANNEL_ID ||
      process.env.ATTACHMENT_FORUM_CHANNEL_ID ||
      guildSettings.attachmentArchiveChannelId ||
      guildSettings.mediaArchiveChannelId ||
      process.env.ATTACHMENT_ARCHIVE_CHANNEL_ID ||
      process.env.MEDIA_ARCHIVE_CHANNEL_ID ||
      "";
  } catch {
    channelId =
      process.env.MEDIA_FORUM_CHANNEL_ID ||
      process.env.ATTACHMENT_FORUM_CHANNEL_ID ||
      process.env.ATTACHMENT_ARCHIVE_CHANNEL_ID ||
      process.env.MEDIA_ARCHIVE_CHANNEL_ID ||
      "";
  }

  attachmentArchiveChannelCache.set(guildId, {
    expiresAt: now + ATTACHMENT_STORAGE_CACHE_TTL_MS,
    channelId
  });

  return channelId;
};

const parseMediaPostLinkData = (value: unknown): MediaPostLinkData | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as { threadId?: unknown; forumChannelId?: unknown; starterMessageId?: unknown };
  if (typeof candidate.threadId !== "string" || typeof candidate.forumChannelId !== "string") {
    return null;
  }
  return {
    threadId: candidate.threadId,
    forumChannelId: candidate.forumChannelId,
    starterMessageId: typeof candidate.starterMessageId === "string" ? candidate.starterMessageId : undefined
  };
};

const getTicketMediaPostLink = async (ticketId: string) => {
  const event = await prisma.ticketEvent.findFirst({
    where: { ticketId, type: "MEDIA_POST_LINK" },
    orderBy: { createdAt: "desc" }
  });
  return parseMediaPostLinkData(event?.data);
};

const saveTicketMediaPostLink = async (ticketId: string, actorId: string, link: MediaPostLinkData) => {
  await prisma.ticketEvent.create({
    data: {
      ticketId,
      type: "MEDIA_POST_LINK",
      actorId,
      data: link
    }
  });
};

const createMediaBackupThread = async (
  ticket: { id: string; guildId: string; channelId: string; ticketNumber?: number | null },
  actorId: string
) => {
  const backupChannelId = await getMediaForumChannelIdForGuild(ticket.guildId);
  if (!backupChannelId) {
    return null;
  }

  const backupChannel = await client.channels.fetch(backupChannelId).catch(() => null);
  if (!backupChannel || (backupChannel.type !== ChannelType.GuildText && backupChannel.type !== ChannelType.GuildAnnouncement)) {
    return null;
  }

  const threadName = await getTicketTitleForMediaPost(ticket);
  const starterMessage = await backupChannel.send(`Media backup thread for ${getTicketDisplayLabel(ticket)}`);
  const thread = await starterMessage.startThread({ name: threadName }).catch(() => null);
  if (!thread) {
    return null;
  }

  await thread.send(`Ticket UUID: ${ticket.id}`).catch(() => null);
  await saveTicketMediaPostLink(ticket.id, actorId, {
    threadId: thread.id,
    forumChannelId: backupChannel.id,
    starterMessageId: starterMessage.id
  });

  return thread;
};

const getTicketTitleForMediaPost = async (ticket: { id: string; channelId: string; ticketNumber?: number | null }) => {
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel && channel.type === ChannelType.GuildText) {
    return channel.name;
  }
  return getTicketDisplayLabel(ticket);
};

const enforceReadOnlyMediaPost = async (thread: import("discord.js").AnyThreadChannel) => {
  await thread.setLocked(true).catch(() => null);
};

const buildMediaEmbed = (
  ticketLabel: string,
  message: import("discord.js").Message
) => {
  const sentAtUnix = Math.floor(message.createdTimestamp / 1000);
  const description = message.content?.trim() || "(No text content)";
  return new EmbedBuilder()
    .setColor(PRIMARY_EMBED_COLOR)
    .setTitle(`Media • ${ticketLabel}`)
    .setDescription(description.slice(0, 4000))
    .addFields(
      { name: "Sent By", value: `<@${message.author.id}>`, inline: true },
      { name: "Sent At", value: `<t:${sentAtUnix}:F>`, inline: true },
      { name: "Source", value: `[Jump to message](${message.url})`, inline: false }
    )
    .setFooter({ text: BRAND_FOOTER });
};

const getAttachmentChunks = (message: import("discord.js").Message) => {
  const attachments = [...message.attachments.values()].map(
    (attachment, index) =>
      new AttachmentBuilder(attachment.url, {
        name: attachment.name || `attachment-${index + 1}`
      })
  );
  const chunks: AttachmentBuilder[][] = [];
  for (let index = 0; index < attachments.length; index += 10) {
    chunks.push(attachments.slice(index, index + 10));
  }
  return chunks;
};

const createMediaPostWithFirstMessage = async (
  ticket: { id: string; guildId: string; channelId: string; ticketNumber?: number | null },
  message: import("discord.js").Message
) => {
  const created = await createMediaBackupThread(ticket, message.author.id);
  if (!created) {
    return;
  }

  const ticketLabel = getTicketDisplayLabel(ticket);
  const attachmentChunks = getAttachmentChunks(message);
  if (attachmentChunks.length === 0) {
    return;
  }

  await prisma.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: "MEDIA_FORWARD",
      actorId: message.author.id,
      data: {
        messageId: message.id,
        attachmentCount: message.attachments.size,
        threadId: created.id
      }
    }
  });

  for (let index = 0; index < attachmentChunks.length; index += 1) {
    await created.send({
      embeds: [buildMediaEmbed(ticketLabel, message)],
      files: attachmentChunks[index]
    });
  }

  await enforceReadOnlyMediaPost(created);
  return created;
};

const getLinkedMediaThread = async (ticketId: string) => {
  const link = await getTicketMediaPostLink(ticketId);
  if (!link) {
    return null;
  }
  const channel = await client.channels.fetch(link.threadId).catch(() => null);
  if (!channel || !channel.isThread()) {
    return null;
  }
  return channel;
};

const forwardMediaToTicketPost = async (
  ticket: { id: string; guildId: string; channelId: string; ticketNumber?: number | null },
  message: import("discord.js").Message
) => {
  if (message.attachments.size === 0) {
    return;
  }

  const linkedThread = await getLinkedMediaThread(ticket.id);
  if (!linkedThread) {
    await createMediaPostWithFirstMessage(ticket, message);
    return;
  }

  await linkedThread.setLocked(false).catch(() => null);

  const ticketLabel = getTicketDisplayLabel(ticket);
  const chunks = getAttachmentChunks(message);
  for (const chunk of chunks) {
    await linkedThread.send({
      embeds: [buildMediaEmbed(ticketLabel, message)],
      files: chunk
    });
  }

  await prisma.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: "MEDIA_FORWARD",
      actorId: message.author.id,
      data: {
        messageId: message.id,
        attachmentCount: message.attachments.size,
        threadId: linkedThread.id
      }
    }
  });

  await enforceReadOnlyMediaPost(linkedThread);
};

const syncTicketMediaPostTitle = async (ticket: { id: string }, title: string) => {
  const link = await getTicketMediaPostLink(ticket.id);
  if (!link?.starterMessageId) {
    return;
  }

  const parentChannel = await client.channels.fetch(link.forumChannelId).catch(() => null);
  if (!parentChannel || parentChannel.type !== ChannelType.GuildText) {
    return;
  }

  const starterMessage = await parentChannel.messages.fetch(link.starterMessageId).catch(() => null);
  if (!starterMessage) {
    return;
  }

  const normalized = title.trim().slice(0, 100);
  if (!normalized) {
    return;
  }

  await starterMessage.edit(`Media backup thread for ${normalized}`).catch(() => null);
};

const finalizeTicketMediaPost = async (ticket: {
  id: string;
  guildId: string;
  channelId: string;
  ticketNumber?: number | null;
  closeReason?: string | null;
}) => {
  let thread = await getLinkedMediaThread(ticket.id);
  const hadMirroredMedia = Boolean(
    await prisma.ticketEvent.findFirst({
      where: { ticketId: ticket.id, type: "MEDIA_FORWARD" },
      select: { id: true }
    })
  );

  if (!thread) {
    thread = await createMediaBackupThread(ticket, "system");
    if (thread && !hadMirroredMedia) {
      await thread.send("No media available for this ticket.").catch(() => null);
    }
  } else if (!hadMirroredMedia) {
    await thread.send("No media available for this ticket.").catch(() => null);
  }

  if (!thread) {
    return;
  }

  await thread
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(PRIMARY_EMBED_COLOR)
          .setTitle("Ticket has been closed")
          .setDescription(ticket.closeReason || "No reason provided")
          .setFooter({ text: BRAND_FOOTER })
      ]
    })
    .catch(() => null);

  await enforceReadOnlyMediaPost(thread);
  await thread.setLocked(true).catch(() => null);
};

const parseModalSchema = (value: unknown): ModalSchema | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const modal = value as { title?: unknown; fields?: unknown };
  if (typeof modal.title !== "string" || !Array.isArray(modal.fields)) {
    return null;
  }
  const fields: ModalField[] = [];
  for (const entry of modal.fields) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const field = entry as {
      id?: unknown;
      label?: unknown;
      style?: unknown;
      required?: unknown;
      placeholder?: unknown;
      minLength?: unknown;
      maxLength?: unknown;
    };
    if (typeof field.id !== "string" || typeof field.label !== "string") {
      continue;
    }
    if (field.style !== "short" && field.style !== "paragraph") {
      continue;
    }
    const required = typeof field.required === "boolean" ? field.required : true;
    const modalField: ModalField = {
      id: field.id,
      label: field.label,
      style: field.style,
      required
    };
    if (typeof field.placeholder === "string") {
      modalField.placeholder = field.placeholder;
    }
    if (typeof field.minLength === "number") {
      modalField.minLength = field.minLength;
    }
    if (typeof field.maxLength === "number") {
      modalField.maxLength = field.maxLength;
    }
    fields.push(modalField);
  }
  if (fields.length === 0) {
    return null;
  }
  return { title: modal.title, fields: fields.slice(0, 5) };
};

const buildPanelEmbed = async (panelId: string) => {
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, isActive: true },
    include: {
      categories: {
        include: { category: true },
        orderBy: { sortOrder: "asc" }
      }
    }
  });
  if (!panel) {
    throw new Error("panel_not_found");
  }
  const topBanner = new EmbedBuilder().setColor(PRIMARY_EMBED_COLOR).setImage(`attachment://${PANEL_TOP_BANNER_NAME}`);
  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description)
    .setColor(PRIMARY_EMBED_COLOR)
    .setFooter({ text: BRAND_FOOTER });
  const bottomBanner = new EmbedBuilder()
    .setColor(PRIMARY_EMBED_COLOR)
    .setImage(`attachment://${PANEL_BOTTOM_BANNER_NAME}`);
  panel.categories
    .filter((link) => link.enabled && link.category.enabled)
    .forEach((link) => {
      embed.addFields({
        name: link.category.name,
        value: link.category.description
      });
    });
  const options = panel.categories
    .filter((link) => link.enabled && link.category.enabled)
    .map((link) => ({
      label: link.category.name,
      value: link.category.id
    }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`panel:${panel.id}`)
    .setPlaceholder("Select a category")
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const files = [
    new AttachmentBuilder(getAssetFilePath(PANEL_TOP_BANNER_NAME), { name: PANEL_TOP_BANNER_NAME }),
    new AttachmentBuilder(getAssetFilePath(PANEL_BOTTOM_BANNER_NAME), { name: PANEL_BOTTOM_BANNER_NAME })
  ];
  return { panel, embeds: [topBanner, embed, bottomBanner], components: [row], files };
};

const buildPermissionOverwrites = async (guildId: string, userId: string, supportTeamId: string) => {
  const guild = await client.guilds.fetch(guildId);
  const team = await prisma.supportTeam.findFirst({
    where: { id: supportTeamId },
    include: { roles: true }
  });
  if (!team) {
    throw new Error("team_not_found");
  }
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    },
    {
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];
  team.roles.forEach((role) => {
    overwrites.push({
      id: role.roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  });
  return { overwrites, team };
};

const publishPanel = async (panelId: string) => {
  const { panel, embeds, components, files } = await buildPanelEmbed(panelId);
  const guild = await client.guilds.fetch(panel.guildId);
  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error("panel_channel_invalid");
  }
  if (panel.messageId) {
    const message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds, components, files });
      return;
    }
  }
  const message = await channel.send({ embeds, components, files });
  await prisma.ticketPanel.update({
    where: { id: panel.id },
    data: { messageId: message.id }
  });
};

const findOpenTicket = async (guildId: string, userId: string, categoryId: string) => {
  const tickets = await prisma.ticket.findMany({
    where: {
      guildId,
      ownerId: userId,
      categoryId,
      status: { in: [TicketStatus.Open, TicketStatus.InProgress, TicketStatus.Waiting] }
    },
    orderBy: { createdAt: "desc" }
  });

  for (const ticket of tickets) {
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (channel && channel.type === ChannelType.GuildText) {
      return ticket;
    }

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.Closed,
        closeReason: "Ticket channel was deleted",
        closedAt: new Date(),
        lastActivityAt: new Date()
      }
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "AUTO_CLOSE_MISSING_CHANNEL",
        actorId: "system",
        data: { channelId: ticket.channelId }
      }
    });
  }

  return null;
};

const buildTicketModal = (categoryId: string, schema: ModalSchema) => {
  const modal = new ModalBuilder().setCustomId(`ticket-modal:${categoryId}`).setTitle(schema.title);
  const rows = schema.fields.map((field) => {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required);
    if (field.placeholder) {
      input.setPlaceholder(field.placeholder);
    }
    if (typeof field.minLength === "number") {
      input.setMinLength(field.minLength);
    }
    if (typeof field.maxLength === "number") {
      input.setMaxLength(field.maxLength);
    }
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  });
  modal.addComponents(rows);
  return modal;
};

const buildCloseModal = (ticketId: string) => {
  const modal = new ModalBuilder()
    .setCustomId(`ticket-close:${ticketId}`)
    .setTitle("Close Ticket");
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Optional reason")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("Add a short reason for closing this ticket (optional)")
    .setMaxLength(400);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
  return modal;
};

const buildCloseRequestButtons = (ticketId: string, disabled = false) => {
  const accept = new ButtonBuilder()
    .setCustomId(`closerequest:accept:${ticketId}`)
    .setLabel("Accept Close")
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);
  const deny = new ButtonBuilder()
    .setCustomId(`closerequest:deny:${ticketId}`)
    .setLabel("Keep Open")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(accept, deny);
};

const applyClaimedPermissions = async (ticketId: string, claimedById: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId },
    include: { supportTeam: { include: { roles: true } } }
  });
  if (!ticket) {
    return;
  }
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return;
  }
  for (const role of ticket.supportTeam.roles) {
    await channel.permissionOverwrites.edit(role.roleId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false
    });
  }
  await channel.permissionOverwrites.edit(ticket.ownerId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true
  });
  await channel.permissionOverwrites.edit(claimedById, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true
  });
};

const createTicket = async (
  guildId: string,
  userId: string,
  category: { id: string; name: string; supportTeamId: string; parentChannelId: string | null },
  modalData?: Record<string, string>
) => {
  const { overwrites, team } = await buildPermissionOverwrites(guildId, userId, category.supportTeamId);
  const ticketId = randomUUID();
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.create({
    name: `ticket-${ticketId.slice(0, 6)}`,
    type: ChannelType.GuildText,
    parent: category.parentChannelId || undefined,
    permissionOverwrites: overwrites
  });
  if (category.parentChannelId && channel.parentId !== category.parentChannelId) {
    await channel.setParent(category.parentChannelId);
  }
  const ticket = await prisma.ticket.create({
    data: {
      id: ticketId,
      guildId,
      categoryId: category.id,
      supportTeamId: category.supportTeamId,
      status: TicketStatus.Open,
      ownerId: userId,
      channelId: channel.id
    }
  });
  const ticketLabel = getTicketDisplayLabel(ticket);
  if (channel.name !== ticketLabel) {
    await channel.setName(ticketLabel).catch(() => null);
  }
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticket.id}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticket.id}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );
  const embed = new EmbedBuilder()
    .setTitle(ticketLabel)
    .setDescription(
      "Please send your issue details so the team can help quickly.\n\nThis ticket auto-closes after 48 hours of inactivity and will be closed if there is no reply within the first 30 minutes."
    )
    .setColor(PRIMARY_EMBED_COLOR)
    .setFooter({ text: BRAND_FOOTER });
  const roleMentions = team.roles.map((role) => `<@&${role.roleId}>`).join(" ");
  await channel.send({
    content: `${roleMentions} New ${category.name} ticket opened by <@${userId}>.`,
    embeds: [embed],
    components: [actionRow]
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: "CREATE",
      actorId: userId,
      data: modalData ? { modal: modalData } : undefined
    }
  });
  return ticket;
};

const getTicketById = async (ticketId: string) => {
  return prisma.ticket.findFirst({
    where: { id: ticketId },
    include: {
      supportTeam: { include: { roles: true } },
      category: true
    }
  });
};

const getTicketByChannel = async (channelId: string) => {
  return prisma.ticket.findFirst({
    where: { channelId, status: { not: TicketStatus.Closed } },
    include: { supportTeam: { include: { roles: true } }, category: true }
  });
};

const getEnabledCategories = async (guildId: string) => {
  return prisma.ticketCategory.findMany({
    where: { guildId, enabled: true },
    orderBy: { sortOrder: "asc" }
  });
};

const formatTicketChannelName = (ticketNumber: number) => `ticket-${String(ticketNumber).padStart(4, "0")}`;

const getTicketDisplayLabel = (ticket: { ticketNumber?: number | null; id: string }) => {
  if (typeof ticket.ticketNumber === "number") {
    return formatTicketChannelName(ticket.ticketNumber);
  }
  return `ticket-${ticket.id.slice(0, 6)}`;
};

const buildCategorySelect = (customId: string, categories: { id: string; name: string }[]) => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a category")
    .addOptions(
      categories.map((category) => ({
        label: category.name,
        value: category.id
      }))
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const userHasTeamRole = (roleIds: string[], ticket: Awaited<ReturnType<typeof getTicketById>>) => {
  if (!ticket) {
    return false;
  }
  const teamRoles = ticket.supportTeam.roles.map((role) => role.roleId);
  return roleIds.some((roleId) => teamRoles.includes(roleId));
};

const userHasSupportRole = async (guildId: string, roleIds: string[]) => {
  const teamRoles = await prisma.supportTeamRole.findMany({
    where: { team: { guildId } }
  });
  const allowedRoleIds = new Set(teamRoles.map((role) => role.roleId));
  return roleIds.some((roleId) => allowedRoleIds.has(roleId));
};

const BYPASS_USER_ID = process.env.DEV_BYPASS_USER_ID || "";

const BYPASS_USER_IDS = new Set(
  BYPASS_USER_ID
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const hasSuperuserBypass = (userId: string) => {
  if (!userId) {
    return false;
  }
  if (BYPASS_USER_IDS.has(userId)) {
    return true;
  }
  return isConfiguredSuperuser(userId, getConfiguredSuperusers());
};

const auditSuperuserBypass = (params: {
  action: string;
  userId: string;
  username?: string;
  guildId?: string | null;
  channelId?: string | null;
  details?: string;
}) => {
  const parts = [
    "⚠️ SuperUser bypass detected",
    `action=${params.action}`,
    `by=${params.username ? `${params.username} (${params.userId})` : params.userId}`,
    `when=${new Date().toISOString()}`,
    `guild=${params.guildId || "unknown"}`,
    `channel=${params.channelId || "unknown"}`
  ];
  if (params.details) {
    parts.push(`details=${params.details}`);
  }
  console.warn(parts.join(" | "));
};

const isAuthorizedForTicket = async (userId: string, guildId: string, roleIds: string[], ticket?: Awaited<ReturnType<typeof getTicketById>>) => {
  // Bypass for superusers
  if (hasSuperuserBypass(userId)) return true;
  
  // Check for admin
  try {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member?.permissions.has("Administrator")) return true;
    }
  } catch (e) {
    // Continue to support role check
  }
  
  // Check support roles
  if (ticket) {
    const hasTeam = userHasTeamRole(roleIds, ticket);
    return hasTeam;
  }
  
  return await userHasSupportRole(guildId, roleIds);
};

const canManageTicket = async (
  userId: string,
  guildId: string,
  roleIds: string[],
  ticket: Awaited<ReturnType<typeof getTicketById>>
) => {
  if (!ticket) {
    return false;
  }
  if (hasSuperuserBypass(userId)) {
    return true;
  }
  const isAuthorized = await isAuthorizedForTicket(userId, guildId, roleIds, ticket);
  if (!isAuthorized) {
    return false;
  }
  if (!ticket.claimedById) {
    return true;
  }
  return ticket.claimedById === userId;
};

const switchTicketToTeam = async (
  ticket: NonNullable<Awaited<ReturnType<typeof getTicketById>>>,
  actorId: string,
  teamId: string
) => {
  const category = await prisma.ticketCategory.findFirst({
    where: { guildId: ticket.guildId, supportTeamId: teamId, enabled: true },
    orderBy: { sortOrder: "asc" }
  });
  if (!category) {
    throw new Error("team_has_no_category");
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      categoryId: category.id,
      supportTeamId: category.supportTeamId,
      claimedById: null,
      status: TicketStatus.Open,
      lastActivityAt: new Date()
    }
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: "TRANSFER",
      actorId,
      data: { fromCategoryId: ticket.categoryId, toCategoryId: category.id, toTeamId: teamId }
    }
  });

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel && channel.type === ChannelType.GuildText) {
    const { overwrites } = await buildPermissionOverwrites(ticket.guildId, ticket.ownerId, category.supportTeamId);
    await channel.permissionOverwrites.set(overwrites);
    await channel.setParent(category.parentChannelId || null).catch(() => null);
    const switchedTeam = await prisma.supportTeam.findFirst({
      where: { id: teamId },
      include: { roles: true }
    });
    const mentions = switchedTeam?.roles.map((role) => `<@&${role.roleId}>`).join(" ") || "";
    await channel.send({
      content: `${mentions} Ticket switched to **${switchedTeam?.name || "selected team"}** by <@${actorId}>. Ticket has been unclaimed.`
    });
  }

  const team = await prisma.supportTeam.findFirst({ where: { id: teamId } });
  return { teamName: team?.name || "selected team" };
};

const autocompleteTeams = async (interaction: AutocompleteInteraction) => {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "team") {
    await interaction.respond([]);
    return;
  }
  try {
    const query = String(focused.value || "").toLowerCase();
    const allTeams = await getTeamsForAutocomplete(interaction.guildId);
    const teams = allTeams
      .filter((team) => team.name.toLowerCase().includes(query))
      .slice(0, 25);
    await interaction.respond(
      teams.map((team) => ({ name: team.name, value: team.id }))
    );
  } catch (error) {
    if (isPrismaPoolTimeout(error)) {
      console.warn(
        `[autocomplete] Prisma connection pool timeout (P2024) while fetching teams for guild ${interaction.guildId}.`
      );
    } else {
      console.error("[autocomplete] Failed to fetch teams:", error);
    }
    await interaction.respond([]).catch(() => null);
  }
};

const registerCommands = async () => {
  const appId = process.env.DISCORD_APP_ID || "";
  const guildId = process.env.DISCORD_GUILD_ID || "";
  const token = process.env.DISCORD_BOT_TOKEN || "";
  if (!appId || !guildId || !token) {
    throw new Error("command_env_missing");
  }
  const commands = [
    new SlashCommandBuilder()
      .setName("open")
      .setDescription("Open a ticket"),
    new SlashCommandBuilder()
      .setName("claim")
      .setDescription("Claim the current ticket"),
    new SlashCommandBuilder()
      .setName("unclaim")
      .setDescription("Unclaim the current ticket"),
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close the current ticket")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional reason for closing the ticket")
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Panel actions")
      .addSubcommand((sub) =>
        sub
          .setName("publish").setDescription("Publish a panel for a channel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Channel with the panel")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText)
          )
      ),
    new SlashCommandBuilder()
      .setName("switchcategory")
      .setDescription("Switch current ticket to another team's category")
      .addStringOption((option) =>
        option
          .setName("team")
          .setDescription("Target support team")
          .setRequired(true)
          .setAutocomplete(true)
      ),
    new SlashCommandBuilder()
      .setName("rename")
      .setDescription("Rename current ticket channel")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Optional channel name (letters, numbers, dashes)")
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("superuser")
      .setDescription("Display current superuser access information"),
    new SlashCommandBuilder()
      .setName("closerequest")
      .setDescription("Request ticket closure from the ticket creator")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Reason for requesting closure")
          .setRequired(true)
      )
  
  ].map((command) => command.toJSON());
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const isImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(pathname)) {
      return true;
    }

    const format = parsed.searchParams.get("format")?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(format)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

const renderTranscriptContentHtml = (raw: string) => {
  const value = raw || "";
  const urlPattern = /https?:\/\/[^\s<>'"]+/g;
  const parts: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(value)) !== null) {
    const start = match.index;
    const url = match[0];
    const textChunk = value.slice(cursor, start);
    if (textChunk) {
      parts.push(escapeHtml(textChunk).replaceAll("\n", "<br />"));
    }

    const safeUrl = escapeHtml(url);
    if (isImageUrl(url)) {
      parts.push(
        `<div class="attachment"><a class="link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a><img src="${safeUrl}" alt="Attachment" loading="lazy" /></div>`
      );
    } else {
      parts.push(`<a class="link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`);
    }

    cursor = start + url.length;
  }

  if (cursor < value.length) {
    parts.push(escapeHtml(value.slice(cursor)).replaceAll("\n", "<br />"));
  }

  return parts.join("");
};

const buildTranscriptHtml = (
  ticketLabel: string,
  lines: Array<{ timestamp: number; author: string; content: string }>
) => {
  const rows = lines
    .map((line) => {
      const time = new Date(line.timestamp).toLocaleString();
      return `
      <article class="msg">
        <div class="meta">${escapeHtml(line.author)} • ${escapeHtml(time)}</div>
        <div class="content">${renderTranscriptContentHtml(line.content || "(no text content)")}</div>
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(APP_NAME)} • Ticket Transcript ${escapeHtml(ticketLabel)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Inter", "Segoe UI", sans-serif;
        color: #e2e8f0;
      }
      html, body {
        margin: 0;
        min-height: 100%;
        background: transparent;
        color: #e2e8f0;
      }
      body { padding: 24px; }
      .wrap { max-width: 960px; margin: 0 auto; }
      .card {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 14px;
        padding: 18px;
      }
      h1 { margin: 0 0 12px; font-size: 24px; }
      .msg {
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 10px 12px;
        background: #1e293b;
        margin-bottom: 10px;
      }
      .meta { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
      .content { white-space: pre-wrap; word-break: break-word; font-size: 14px; }
      .link { color: #93c5fd; text-decoration: underline; }
      .attachment { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
      .attachment img {
        max-width: min(100%, 560px);
        max-height: 420px;
        border-radius: 10px;
        border: 1px solid #334155;
        object-fit: contain;
        background: #0b1220;
      }

      @media (prefers-color-scheme: light) {
        :root {
          color-scheme: light;
          color: #0f172a;
        }
        html, body {
          background: transparent;
          color: #0f172a;
        }
        .card { background: #ffffff; border-color: #dbe4ef; }
        .msg { background: #f8fafc; border-color: #e2e8f0; }
        .meta { color: #475569; }
        .link { color: #1d4ed8; }
        .attachment img { border-color: #dbe4ef; background: #ffffff; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1>${escapeHtml(APP_NAME)} • Ticket Transcript • ${escapeHtml(ticketLabel)}</h1>
        ${rows || "<p>No messages captured.</p>"}
      </section>
    </main>
  </body>
</html>`;
};

const getDashboardTranscriptUrl = (ticketId: string) => {
  const base = (
    process.env.DASHBOARD_ORIGIN ||
    process.env.DASHBOARD_URL ||
    process.env.PUBLIC_DASHBOARD_URL ||
    "https://ukrrp.m4rv1n.dev"
  ).trim();
  if (!base) {
    return "";
  }
  return `${base.replace(/\/$/, "")}/#/transcripts/${ticketId}`;
};

const closeTicket = async (ticketId: string, actorId: string, reason?: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId },
    include: { supportTeam: { include: { roles: true } } }
  });
  if (!ticket) {
    return;
  }
  const normalizedReason = reason?.trim() || (actorId === "system" ? "Closed due to inactivity" : undefined);
  const closedAt = new Date();
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: TicketStatus.Closed,
      closeReason: normalizedReason || null,
      closedAt,
      lastActivityAt: closedAt
    }
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId,
      type: "CLOSE",
      actorId,
      data: normalizedReason ? { reason: normalizedReason } : undefined
    }
  });

  await finalizeTicketMediaPost({
    id: ticket.id,
    guildId: ticket.guildId,
    channelId: ticket.channelId,
    ticketNumber: ticket.ticketNumber,
    closeReason: normalizedReason || null
  }).catch((error) => {
    console.warn("[media-post] Failed to finalize media post", {
      ticketId,
      channelId: ticket.channelId,
      error
    });
  });

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  const ticketLabel = getTicketDisplayLabel(ticket);
  if (channel && channel.type === ChannelType.GuildText) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const transcriptLines: Array<{ timestamp: number; author: string; content: string }> = [];
    if (messages) {
      const sorted = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((message) => {
          const author = message.author ? `${message.author.username}` : "unknown";
          const text = [message.content, ...message.attachments.map((attachment) => attachment.url)]
            .filter(Boolean)
            .join("\n");
          return {
            timestamp: message.createdTimestamp,
            author,
            content: text
          };
        })
        .filter((line) => line.content.length > 0);
      transcriptLines.push(...sorted);

      const transcript = buildTranscriptHtml(ticketLabel, transcriptLines);
      await prisma.ticketTranscript.upsert({
        where: { ticketId },
        create: { ticketId, content: transcript },
        update: { content: transcript }
      });

      const transcriptChannelId = await getTranscriptChannelIdForGuild(ticket.guildId);
      const transcriptChannel = transcriptChannelId
        ? await client.channels.fetch(transcriptChannelId).catch(() => null)
        : null;
      const destination = transcriptChannel && transcriptChannel.type === ChannelType.GuildText
        ? transcriptChannel
        : channel;

      const closedByValue = actorId === "system" ? "System" : `<@${actorId}>`;
      const transcriptUrl = getDashboardTranscriptUrl(ticket.id);
      const embed = new EmbedBuilder()
        .setColor(PRIMARY_EMBED_COLOR)
        .setTitle(`${ticketLabel} Closed`)
        .setDescription("Ticket transcript has been logged. Use the button below to view it in the dashboard.")
        .addFields(
          { name: "Opened", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:F>`, inline: true },
          { name: "Closed", value: `<t:${Math.floor(closedAt.getTime() / 1000)}:F>`, inline: true },
          { name: "Opened By", value: `<@${ticket.ownerId}>`, inline: true },
          { name: "Closed By", value: closedByValue, inline: true },
          { name: "Reason", value: normalizedReason || "No reason provided" }
        );

      const components = transcriptUrl
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Open Transcript in Dashboard")
                .setURL(transcriptUrl)
            )
          ]
        : [];

      await destination.send({
        embeds: [embed],
        components
      });
    }
    await channel.permissionOverwrites.edit(ticket.ownerId, {
      SendMessages: false
    });
    ticket.supportTeam.roles.forEach((role) => {
      channel.permissionOverwrites.edit(role.roleId, {
        SendMessages: false
      });
    });
    await channel.delete("Ticket closed").catch(() => null);
  }
};

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "switchcategory") {
      await autocompleteTeams(interaction);
    }
    return;
  }

  const handleOpenCategory = async (
    categoryId: string,
    sourceInteraction: ChatInputCommandInteraction | StringSelectMenuInteraction
  ) => {
    if (!sourceInteraction.guildId) {
      await sourceInteraction.reply({ content: "Guild not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const existing = await findOpenTicket(sourceInteraction.guildId, sourceInteraction.user.id, categoryId);
    if (existing) {
      await sourceInteraction.reply({ content: "You already have an open ticket in this category.", flags: MessageFlags.Ephemeral });
      return;
    }
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: sourceInteraction.guildId, enabled: true }
    });
    if (!category) {
      await sourceInteraction.reply({ content: "Category not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const modalSchema = parseModalSchema(category.modalSchema);
    if (modalSchema) {
      await sourceInteraction.showModal(buildTicketModal(categoryId, modalSchema));
      return;
    }
    const ticket = await createTicket(sourceInteraction.guildId, sourceInteraction.user.id, category);
    await sourceInteraction.reply({
      content: `${getTicketDisplayLabel(ticket)} created: <#${ticket.channelId}>.`,
      flags: MessageFlags.Ephemeral
    });
  };

  if (interaction.isChatInputCommand()) {
    const optionsSummary = interaction.options.data
      .map((option) => `${option.name}=${option.value ?? ""}`)
      .join(", ");
    console.info(
      `[command] /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id}) guild=${interaction.guildId || "none"} channel=${interaction.channelId || "none"}${optionsSummary ? ` options=${optionsSummary}` : ""}`
    );

    if (!interaction.guildId) {
      await interaction.reply({ content: "Guild not found.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "superuser") {
      const records = getConfiguredSuperusers();
      const requesterIsSuperuser = isConfiguredSuperuser(interaction.user.id, records);
      const showIdsForSuperuser = (process.env.SUPERUSER_SHOW_IDS || "true").toLowerCase() !== "false";

      const profileFields = records.slice(0, 20).map((record, index) => {
        const mention = `<@${record.user_id}>`;
        const displayName = record.username?.trim() || record.display_name?.trim() || mention;
        const designation = record.designation?.trim();
        const role = record.role?.trim() || "Unknown Role";
        const fieldTitle = (designation || role || displayName).slice(0, 256) || `Superuser ${index + 1}`;
        const grantedAt = toDiscordTimestamp(record.granted_at) || "Not set";
        const lines = [`**${displayName}**`];
        if (designation) {
          lines.push(`Designation: ${designation}`);
        }
        lines.push(`Role: ${role}`);
        lines.push(`Granted on: ${grantedAt}`);
        if (requesterIsSuperuser && showIdsForSuperuser) {
          lines.push(`User ID: ${record.user_id}`);
        }
        return {
          name: fieldTitle,
          value: lines.join("\n"),
          inline: false
        };
      });

      const accentColor = requesterIsSuperuser ? 0xf1c40f : 0xe74c3c;

      const embed = new EmbedBuilder()
        .setColor(accentColor)
        .setTitle("Superuser Access")
        .setDescription(
          requesterIsSuperuser
            ? "You are recognized as a superuser. Full privilege metadata is visible below."
            : "You do not have superuser access. Visible list is intentionally redacted."
        )
        .addFields(
          {
            name: "Requester",
            value: `<@${interaction.user.id}>`,
            inline: true
          },
          {
            name: "Configured Superusers",
            value: `${records.length}`,
            inline: true
          },
          {
            name: "Visibility Mode",
            value: requesterIsSuperuser ? "Full" : "Redacted",
            inline: true
          }
        )
        .setFooter({ text: "Superusers have elevated privileges." })
        .setTimestamp(new Date());

      if (profileFields.length > 0) {
        embed.addFields(profileFields);
      } else {
        embed.addFields({ name: "Superusers", value: "No superusers configured." });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "open") {
      const categories = await getEnabledCategories(interaction.guildId);
      if (categories.length === 0) {
        await interaction.reply({ content: "No categories available.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (categories.length === 1) {
        await handleOpenCategory(categories[0].id, interaction);
        return;
      }
      const row = buildCategorySelect(`ticket-open:${interaction.user.id}`, categories);
      await interaction.reply({ content: "Select a category to open.", components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    if (["claim", "unclaim", "close"].includes(interaction.commandName)) {
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: "Use this in a ticket channel.", flags: MessageFlags.Ephemeral });
        return;
      }
      const requesterIsSuperuser = hasSuperuserBypass(interaction.user.id);
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      const roleIds = member?.roles.cache.map((role) => role.id) || [];
      const isAuthorized = await isAuthorizedForTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
      const isOwner = ticket.ownerId === interaction.user.id;
      if (!isAuthorized && !(interaction.commandName === "close" && isOwner)) {
        await interaction.reply({ content: `<@${interaction.user.id}> you are not authorized for this ticket.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.commandName === "claim") {
        if (ticket.claimedById && ticket.claimedById !== interaction.user.id && requesterIsSuperuser) {
          auditSuperuserBypass({
            action: "ticket.claim",
            userId: interaction.user.id,
            username: interaction.user.tag,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            details: `Claim ownership restriction bypassed; currentClaimer=${ticket.claimedById}`
          });
        }
        if (ticket.claimedById && ticket.claimedById !== interaction.user.id && !requesterIsSuperuser) {
          await interaction.reply({ content: `<@${interaction.user.id}> this ticket is already claimed by <@${ticket.claimedById}>.` });
          return;
        }
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { claimedById: interaction.user.id, status: TicketStatus.InProgress }
        });
        await applyClaimedPermissions(ticket.id, interaction.user.id);
        await prisma.ticketEvent.create({
          data: { ticketId: ticket.id, type: "CLAIM", actorId: interaction.user.id }
        });
        await interaction.reply({ content: `Ticket claimed by <@${interaction.user.id}>.` });
        return;
      }

      if (interaction.commandName === "unclaim") {
        if (!ticket.claimedById) {
          await interaction.reply({ content: `<@${interaction.user.id}> this ticket is not currently claimed.` });
          return;
        }
        if (ticket.claimedById !== interaction.user.id && requesterIsSuperuser) {
          auditSuperuserBypass({
            action: "ticket.unclaim",
            userId: interaction.user.id,
            username: interaction.user.tag,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            details: `Claimer-only restriction bypassed; currentClaimer=${ticket.claimedById || "none"}`
          });
        }
        if (ticket.claimedById !== interaction.user.id && !requesterIsSuperuser) {
          await interaction.reply({ content: `<@${interaction.user.id}> only the current claimer can unclaim this ticket.` });
          return;
        }
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            claimedById: null,
            status: TicketStatus.Open,
            lastActivityAt: new Date()
          }
        });
        const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel && channel.type === ChannelType.GuildText) {
          const { overwrites } = await buildPermissionOverwrites(ticket.guildId, ticket.ownerId, ticket.supportTeamId);
          await channel.permissionOverwrites.set(overwrites);
        }
        await prisma.ticketEvent.create({
          data: { ticketId: ticket.id, type: "UNCLAIM", actorId: interaction.user.id }
        });
        await interaction.reply({ content: `Ticket unclaimed by <@${interaction.user.id}>.` });
        return;
      }

      if (interaction.commandName === "close") {
        const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
        const canClose = canManage || ticket.ownerId === interaction.user.id;
        if (!canClose) {
          await interaction.reply({ content: `<@${interaction.user.id}> only the ticket owner or current claimer can close this ticket.` });
          return;
        }
        const reason = interaction.options.getString("reason")?.trim() || undefined;
        await interaction.reply({ content: "Ticket closure confirmed." });
        await closeTicket(ticket.id, interaction.user.id, reason);
        return;
      }
    }
    if (interaction.commandName === "panel") {
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      const requesterIsSuperuser = hasSuperuserBypass(interaction.user.id);
      const isAdministrator = member?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
      if (!isAdministrator && requesterIsSuperuser) {
        auditSuperuserBypass({
          action: "panel.publish",
          userId: interaction.user.id,
          username: interaction.user.tag,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          details: "Administrator permission restriction bypassed"
        });
      }
      if (!isAdministrator && !requesterIsSuperuser) {
        await interaction.reply({ content: `<@${interaction.user.id}> you must have Administrator permission to publish panels.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Select a text channel.", flags: MessageFlags.Ephemeral });
        return;
      }
      const panel = await prisma.ticketPanel.findFirst({
        where: { guildId: interaction.guildId, channelId: channel.id, isActive: true }
      });
      if (!panel) {
        await interaction.reply({ content: "Panel not found for this channel.", flags: MessageFlags.Ephemeral });
        return;
      }
      await publishPanel(panel.id);
      await interaction.reply({ content: "Panel published.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "switchcategory") {
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: "Use this in a ticket channel.", flags: MessageFlags.Ephemeral });
        return;
      }
      const requesterIsSuperuser = hasSuperuserBypass(interaction.user.id);
      if (!ticket.claimedById && requesterIsSuperuser) {
        auditSuperuserBypass({
          action: "ticket.switchcategory",
          userId: interaction.user.id,
          username: interaction.user.tag,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          details: "Claim-required restriction bypassed"
        });
      }
      if (!ticket.claimedById && !requesterIsSuperuser) {
        await interaction.reply({ content: `<@${interaction.user.id}> this ticket must be claimed before switching category.` });
        return;
      }
      if (ticket.claimedById !== interaction.user.id && requesterIsSuperuser) {
        auditSuperuserBypass({
          action: "ticket.switchcategory",
          userId: interaction.user.id,
          username: interaction.user.tag,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          details: `Claimer-only restriction bypassed; currentClaimer=${ticket.claimedById || "none"}`
        });
      }
      if (ticket.claimedById !== interaction.user.id && !requesterIsSuperuser) {
        await interaction.reply({ content: `<@${interaction.user.id}> only the current claimer can switch category.` });
        return;
      }
      const teamId = interaction.options.getString("team", true);
      try {
        const result = await switchTicketToTeam(ticket, interaction.user.id, teamId);
        await interaction.reply({ content: `Ticket switched to ${result.teamName}.` });
      } catch (error) {
        if (error instanceof Error && error.message === "team_has_no_category") {
          await interaction.reply({ content: "That team has no enabled category to switch to." });
          return;
        }
        await interaction.reply({ content: "Unable to switch this ticket right now." });
      }
      return;
    }

    if (interaction.commandName === "closerequest") {
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: "Use this in a ticket channel.", flags: MessageFlags.Ephemeral });
        return;
      }
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      const roleIds = member?.roles.cache.map((role) => role.id) || [];
      const requesterIsSuperuser = hasSuperuserBypass(interaction.user.id);
      const isSupport = await userHasSupportRole(ticket.guildId, roleIds);
      if (!isSupport && requesterIsSuperuser) {
        auditSuperuserBypass({
          action: "ticket.closerequest",
          userId: interaction.user.id,
          username: interaction.user.tag,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          details: "Support-staff restriction bypassed"
        });
      }
      if (!isSupport && !requesterIsSuperuser) {
        await interaction.reply({ content: `<@${interaction.user.id}> only support staff can request ticket closure.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const reason = interaction.options.getString("reason", true).trim();
      const embed = new EmbedBuilder()
        .setColor(PRIMARY_EMBED_COLOR)
        .setTitle("Ticket Closure Requested")
        .setDescription(`This ticket has been marked for closure review by <@${interaction.user.id}>.`)
        .addFields(
          { name: "Ticket", value: getTicketDisplayLabel(ticket), inline: true },
          { name: "Requested By", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Reason", value: reason }
        )
        .setFooter({ text: "Only the ticket creator can accept or deny this request." })
        .setTimestamp(new Date());

      await interaction.reply({
        content: `<@${ticket.ownerId}>, support requested to close this ticket.`,
        embeds: [embed],
        components: [buildCloseRequestButtons(ticket.id)]
      });
      return;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-modal:")) {
    const categoryId = interaction.customId.split(":")[1];
    if (!interaction.guildId) {
      await interaction.reply({ content: "Guild not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const existing = await findOpenTicket(interaction.guildId, interaction.user.id, categoryId);
    if (existing) {
      await interaction.reply({ content: "You already have an open ticket in this category.", flags: MessageFlags.Ephemeral });
      return;
    }
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: interaction.guildId, enabled: true }
    });
    if (!category) {
      await interaction.reply({ content: "Category not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const modalSchema = parseModalSchema(category.modalSchema);
    if (!modalSchema) {
      await interaction.reply({ content: "Modal is no longer available.", flags: MessageFlags.Ephemeral });
      return;
    }
    const modalData: Record<string, string> = {};
    for (const field of modalSchema.fields) {
      modalData[field.id] = interaction.fields.getTextInputValue(field.id);
    }
    const ticket = await createTicket(interaction.guildId, interaction.user.id, category, modalData);
    await interaction.reply({
      content: `${getTicketDisplayLabel(ticket)} created: <#${ticket.channelId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-close:")) {
    const ticketId = interaction.customId.split(":")[1];
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      await interaction.reply({ content: "Ticket not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: "Guild not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member?.roles.cache.map((role) => role.id) || [];
    const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
    const canClose = canManage || ticket.ownerId === interaction.user.id;
    if (!canClose) {
      await interaction.reply({ content: `<@${interaction.user.id}> only the ticket owner or current claimer can close this ticket.` });
      return;
    }
    const reason = interaction.fields.getTextInputValue("reason")?.trim() || undefined;
    await interaction.reply({ content: "Ticket closure confirmed." });
    await closeTicket(ticketId, interaction.user.id, reason);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ticket-open:")) {
    const userId = interaction.customId.split(":")[1];
    if (userId !== interaction.user.id) {
      await interaction.reply({ content: `<@${interaction.user.id}> you are not authorized to use this selection.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await handleOpenCategory(interaction.values[0], interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("panel:")) {
    const panelId = interaction.customId.split(":")[1];
    const panel = await prisma.ticketPanel.findFirst({
      where: { id: panelId, isActive: true }
    });
    if (!panel) {
      await interaction.reply({ content: "Panel not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const categoryId = interaction.values[0];
    try {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Guild not found.", flags: MessageFlags.Ephemeral });
        return;
      }
      const existing = await findOpenTicket(interaction.guildId, interaction.user.id, categoryId);
      if (existing) {
        await interaction.reply({ content: "You already have an open ticket in this category.", flags: MessageFlags.Ephemeral });
        return;
      }
      const category = await prisma.ticketCategory.findFirst({
        where: { id: categoryId, guildId: interaction.guildId, enabled: true }
      });
      if (!category) {
        await interaction.reply({ content: "Category not found.", flags: MessageFlags.Ephemeral });
        return;
      }
      const modalSchema = parseModalSchema(category.modalSchema);
      if (modalSchema) {
        await interaction.showModal(buildTicketModal(categoryId, modalSchema));
        return;
      }
      await interaction.deferUpdate();
      const ticket = await createTicket(interaction.guildId, interaction.user.id, category);
      const refreshed = await buildPanelEmbed(panel.id);
      await interaction.editReply({ embeds: refreshed.embeds, components: refreshed.components, files: refreshed.files });
      await interaction.followUp({
        content: `${getTicketDisplayLabel(ticket)} created: <#${ticket.channelId}>.`,
        flags: MessageFlags.Ephemeral
      });
    } catch {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Unable to create ticket.", flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: "Unable to create ticket.", flags: MessageFlags.Ephemeral });
      }
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
    const [_, action, ticketId] = interaction.customId.split(":");
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      await interaction.reply({ content: "Ticket not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member?.roles.cache.map((role) => role.id) || [];
    const requesterIsSuperuser = hasSuperuserBypass(interaction.user.id);
    const isAuthorized = await isAuthorizedForTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
    const isOwner = ticket.ownerId === interaction.user.id;
    if (!isAuthorized && !(action === "close" && isOwner)) {
      await interaction.reply({ content: `<@${interaction.user.id}> you are not authorized for this ticket.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === "claim") {
      if (ticket.claimedById && ticket.claimedById !== interaction.user.id && requesterIsSuperuser) {
        auditSuperuserBypass({
          action: "ticket.button.claim",
          userId: interaction.user.id,
          username: interaction.user.tag,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          details: `Claim ownership restriction bypassed; currentClaimer=${ticket.claimedById}`
        });
      }
      if (ticket.claimedById && ticket.claimedById !== interaction.user.id && !requesterIsSuperuser) {
        await interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedById}>.` });
        return;
      }
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { claimedById: interaction.user.id, status: TicketStatus.InProgress }
      });
      await applyClaimedPermissions(ticketId, interaction.user.id);
      await prisma.ticketEvent.create({
        data: { ticketId, type: "CLAIM", actorId: interaction.user.id }
      });
      await interaction.reply({ content: `Ticket claimed by <@${interaction.user.id}>.` });
      return;
    }
    if (action === "close") {
      const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
      const canClose = canManage || ticket.ownerId === interaction.user.id;
      if (!canClose) {
        await interaction.reply({ content: `<@${interaction.user.id}> only the ticket owner or current claimer can close this ticket.` });
        return;
      }
      await interaction.showModal(buildCloseModal(ticketId));
      return;
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith("closerequest:")) {
    const [_, decision, ticketId] = interaction.customId.split(":");
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      await interaction.reply({ content: "Ticket not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const requesterIsSuperuser = hasSuperuserBypass(interaction.user.id);
    if (interaction.user.id !== ticket.ownerId && requesterIsSuperuser) {
      auditSuperuserBypass({
        action: `ticket.closerequest.${decision}`,
        userId: interaction.user.id,
        username: interaction.user.tag,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        details: `Ticket-owner-only restriction bypassed; ticketOwner=${ticket.ownerId}`
      });
    }
    if (interaction.user.id !== ticket.ownerId && !requesterIsSuperuser) {
      await interaction.reply({ content: `<@${interaction.user.id}> only the ticket creator can respond to this close request.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const previous = EmbedBuilder.from(interaction.message.embeds[0] || new EmbedBuilder().setTitle("Ticket Closure Requested"));
    const currentFields = previous.data.fields || [];
    const reasonField = currentFields.find((field) => field.name === "Reason");
    const baseReason = reasonField?.value || "No reason provided";

    if (decision === "deny") {
      const deniedBy = `<@${interaction.user.id}> denied the close request.`;
      previous
        .setColor(0xe74c3c)
        .setDescription(deniedBy)
        .setFooter({ text: "Close request denied. Ticket remains open." })
        .setTimestamp(new Date());
      await interaction.update({
        embeds: [previous],
        components: [buildCloseRequestButtons(ticketId, true)]
      });
      await interaction.followUp({ content: `<@${interaction.user.id}> denied the closerequest!` });
      await prisma.ticketEvent.create({
        data: {
          ticketId,
          type: "CLOSE_REQUEST_DENY",
          actorId: interaction.user.id,
          data: { reason: baseReason }
        }
      });
      return;
    }

    if (decision === "accept") {
      previous
        .setDescription(`<@${interaction.user.id}> accepted the close request.`)
        .setFooter({ text: "Close request accepted." })
        .setTimestamp(new Date());
      await interaction.update({
        embeds: [previous],
        components: [buildCloseRequestButtons(ticketId, true)]
      });
      await prisma.ticketEvent.create({
        data: {
          ticketId,
          type: "CLOSE_REQUEST_ACCEPT",
          actorId: interaction.user.id,
          data: { reason: baseReason }
        }
      });
      await closeTicket(ticketId, interaction.user.id, `Close request accepted: ${baseReason}`);
      return;
    }

    await interaction.reply({ content: "Invalid close request action.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "rename") {
    const ticket = await getTicketByChannel(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: "Use this in a ticket channel.", flags: MessageFlags.Ephemeral });
      return;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member?.roles.cache.map((role) => role.id) || [];
    const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
    if (!canManage) {
      await interaction.reply({ content: `<@${interaction.user.id}> only the current claimer can manage this ticket.` });
      return;
    }
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Ticket channel not found." });
      return;
    }
    const customNameRaw = interaction.options.getString("name")?.trim() || "";
    const customName = customNameRaw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const baseName = getTicketDisplayLabel(ticket);
    const nextName = customName || baseName;
    await channel.setName(nextName);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { lastActivityAt: new Date() } });
    await syncTicketMediaPostTitle(ticket, nextName).catch((error) => {
      console.warn("[media-post] Failed to sync media post title", {
        ticketId: ticket.id,
        channelId: interaction.channelId,
        nextName,
        error
      });
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "RENAME",
        actorId: interaction.user.id,
        data: { name: nextName }
      }
    });
    await interaction.reply({ content: `Ticket renamed to **${nextName}**.` });
    return;
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) {
    return;
  }
  const ticket = await prisma.ticket.findFirst({
    where: { channelId: message.channel.id, status: { not: TicketStatus.Closed } }
  });
  if (!ticket) {
    return;
  }
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { lastActivityAt: new Date() }
  });

  try {
    await forwardMediaToTicketPost(ticket, message);
  } catch (error) {
    console.warn("[media-post] Failed to forward ticket media", {
      ticketId: ticket.id,
      channelId: message.channel.id,
      messageId: message.id,
      error
    });
  }
});

const startInactivityMonitor = () => {
  const warnHours = Number(process.env.TICKET_INACTIVE_WARN_HOURS || 24);
  const closeHours = Number(process.env.TICKET_INACTIVE_CLOSE_HOURS || 48);
  const warnMs = warnHours * 60 * 60 * 1000;
  const closeMs = closeHours * 60 * 60 * 1000;

  setInterval(async () => {
    const now = Date.now();
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { in: [TicketStatus.Open, TicketStatus.InProgress, TicketStatus.Waiting] }
      }
    });
    for (const ticket of tickets) {
      const last = ticket.lastActivityAt.getTime();
      if (now - last > closeMs) {
        await closeTicket(ticket.id, "system");
        continue;
      }
      if (now - last > warnMs) {
        const existing = await prisma.ticketEvent.findFirst({
          where: { ticketId: ticket.id, type: "INACTIVITY_WARN" }
        });
        if (existing) {
          continue;
        }
        await prisma.ticketEvent.create({
          data: { ticketId: ticket.id, type: "INACTIVITY_WARN", actorId: "system" }
        });
        const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel && channel.type === ChannelType.GuildText) {
          await channel.send("Ticket will be closed if no activity occurs.");
        }
      }
    }
  }, 1000 * 60 * 10);
};

const internalApp = express();
internalApp.use(express.json());
internalApp.use((req, res, next) => {
  const startedAt = Date.now();
  const cfRay = String(req.headers["cf-ray"] || "");
  const cfIp = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "");
  const userAgent = String(req.headers["user-agent"] || "");
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.info(
      `[bot-internal] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms) ip=${cfIp || "unknown"} cfRay=${cfRay || "none"} ua=${userAgent || "unknown"}`
    );
  });
  next();
});
internalApp.post("/internal/panels/:id/sync", async (req, res) => {
  const secret = String(req.headers["x-internal-secret"] || "");
  if (!secret || secret !== process.env.BOT_INTERNAL_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await publishPanel(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "sync_failed" });
  }
});

internalApp.post("/internal/tickets/force-close-open", async (req, res) => {
  const secret = String(req.headers["x-internal-secret"] || "");
  if (!secret || secret !== process.env.BOT_INTERNAL_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const guildId = String(req.body?.guildId || "");
  if (!guildId) {
    res.status(400).json({ error: "guild_id_missing" });
    return;
  }
  const openTickets = await prisma.ticket.findMany({
    where: {
      guildId,
      status: { in: [TicketStatus.Open, TicketStatus.InProgress, TicketStatus.Waiting] }
    },
    select: { id: true }
  });

  let closedCount = 0;
  let failedCount = 0;
  for (const ticket of openTickets) {
    try {
      await closeTicket(ticket.id, "system", "Force closed by superuser");
      closedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  res.json({ ok: true, closedCount, failedCount });
});

const start = async () => {
  const port = Number(process.env.PORT || process.env.INTERNAL_PORT || 3002);
  internalApp.listen(port, () => {
    console.log(`Bot internal server on ${port}`);
  });
  await registerCommands();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  setInterval(() => {
    updateBotPresence();
  }, 1000 * 60 * 10);
  startInactivityMonitor();
};

start();

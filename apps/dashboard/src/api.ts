const apiBase = import.meta.env.VITE_API_BASE as string;
const guildId = import.meta.env.VITE_GUILD_ID as string;

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-guild-id": guildId,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let details = "Request failed";
    try {
      const body = await response.json();
      if (body?.error === "team_in_use") {
        details = "Team cannot be deleted because categories or tickets still reference it.";
      } else if (body?.error === "category_in_use") {
        details = "Category cannot be deleted because tickets still reference it.";
      } else if (body?.error === "reauth_required") {
        details = "Session needs re-authorization. Please log out and sign in again.";
      } else if (body?.error === "bot_auth_failed") {
        details = "API cannot verify guild membership because DISCORD_BOT_TOKEN is missing or invalid in the API environment.";
      } else if (body?.error === "bot_missing_access") {
        details = "API bot does not have access to guild member lookup for the configured guild.";
      } else if (body?.error === "discord_lookup_unavailable") {
        details = "Discord membership lookup is unavailable right now. Check bot access and then re-login.";
      } else if (body?.error === "discord_lookup_failed") {
        details = "Discord member lookup failed. Please try again in a moment.";
      } else if (body?.error === "discord_role_lookup_failed") {
        details = "Discord role lookup failed. Please check bot permissions and try again.";
      } else if (body?.error === "superuser_only") {
        details = "Only the superuser account can delete all transcripts.";
      } else if (body?.error === "bot_internal_missing") {
        details = "Bot internal API is not configured. Set BOT_INTERNAL_URL and BOT_INTERNAL_SECRET in API environment.";
      } else if (body?.error === "bot_force_close_failed") {
        details = "Bot failed to force-close open tickets.";
      } else if (body?.error === "bot_sync_failed") {
        details = "Bot failed to publish/sync the panel message.";
      } else if (body?.error === "panel_field_too_long") {
        details = "Panel title or description is too long for current database schema. Run latest DB migration and try again.";
      } else if (typeof body?.error === "string") {
        details = body.error;
      }
    } catch {
      details = `${response.status} ${response.statusText}`;
    }
    throw new Error(details);
  }
  return response.json();
};

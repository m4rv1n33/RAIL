const apiBase = "https://discord.com/api";

export const exchangeCode = async (code: string) => {
  const params = new URLSearchParams();
  params.set("client_id", process.env.DISCORD_CLIENT_ID || "");
  params.set("client_secret", process.env.DISCORD_CLIENT_SECRET || "");
  params.set("grant_type", "authorization_code");
  params.set("code", code);
  params.set("redirect_uri", process.env.DISCORD_REDIRECT_URI || "");

  const response = await fetch(`${apiBase}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!response.ok) {
    throw new Error("oauth_failed");
  }
  return response.json();
};

export const fetchDiscordUser = async (token: string) => {
  const response = await fetch(`${apiBase}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error("user_fetch_failed");
  }
  return response.json();
};

export const fetchGuildMember = async (guildId: string, userId: string) => {
  const token = process.env.DISCORD_BOT_TOKEN || "";
  if (!token) {
    throw new Error("bot_token_missing");
  }
  const response = await fetch(`${apiBase}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (response.status === 401) {
    throw new Error("bot_auth_failed");
  }
  if (response.status === 403) {
    throw new Error("bot_missing_access");
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("discord_member_lookup_failed");
  }
  return response.json();
};

export const fetchCurrentUserGuildMember = async (accessToken: string, guildId: string) => {
  if (!accessToken) {
    throw new Error("user_token_missing");
  }
  const response = await fetch(`${apiBase}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 401) {
    throw new Error("user_token_invalid");
  }
  if (response.status === 403) {
    throw new Error("oauth_scope_missing");
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("discord_user_member_lookup_failed");
  }
  return response.json();
};

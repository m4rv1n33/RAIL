export const forceCloseOpenTickets = async (guildId: string) => {
  const url = process.env.BOT_INTERNAL_URL || "";
  const secret = process.env.BOT_INTERNAL_SECRET || "";
  if (!url || !secret) {
    throw new Error("bot_internal_missing");
  }
  let response: Response;
  try {
    response = await fetch(`${url}/internal/tickets/force-close-open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret
      },
      body: JSON.stringify({ guildId })
    });
  } catch {
    throw new Error("bot_internal_unreachable");
  }
  if (response.status === 401) {
    throw new Error("bot_internal_unauthorized");
  }
  if (!response.ok) {
    throw new Error("bot_force_close_failed");
  }
  return response.json() as Promise<{ closedCount: number; failedCount: number }>;
};

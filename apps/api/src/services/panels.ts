export const syncPanelMessage = async (panelId: string) => {
  const url = process.env.BOT_INTERNAL_URL || "";
  const secret = process.env.BOT_INTERNAL_SECRET || "";
  if (!url || !secret) {
    throw new Error("bot_internal_missing");
  }
  const response = await fetch(`${url}/internal/panels/${panelId}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": secret
    }
  });
  if (!response.ok) {
    throw new Error("bot_sync_failed");
  }
};

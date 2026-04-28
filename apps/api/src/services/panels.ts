export const syncPanelMessage = async (panelId: string) => {
  const url = process.env.BOT_INTERNAL_URL || "";
  const secret = process.env.BOT_INTERNAL_SECRET || "";
  if (!url || !secret) {
    throw new Error("bot_internal_missing");
  }
  let response: Response;
  try {
    response = await fetch(`${url}/internal/panels/${panelId}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret
      }
    });
  } catch {
    console.error(`[api] Bot internal panel sync unreachable url=${url}/internal/panels/${panelId}/sync`);
    throw new Error("bot_sync_failed");
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(
      `[api] Bot internal panel sync failed status=${response.status} url=${url}/internal/panels/${panelId}/sync body=${bodyText || "<empty>"}`
    );
    throw new Error("bot_sync_failed");
  }
};


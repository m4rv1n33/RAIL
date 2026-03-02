import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { initDiscordLogRelay } from "./logRelay.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  initDiscordLogRelay("dashboard-vite", {
    token: env.DISCORD_BOT_TOKEN,
    channelId: env.DISCORD_LOG_CHANNEL_ID,
    webhookUrl: env.DISCORD_LOG_WEBHOOK_URL
  });

  return {
    plugins: [react()],
    server: {
      port: 5173
    }
  };
});

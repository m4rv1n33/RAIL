import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";

type GuildSettingsRecord = {
  transcriptChannelId?: string;
};

type SettingsStore = Record<string, GuildSettingsRecord>;

const resolveSettingsFilePath = () => {
  const candidates = [
    path.resolve(process.cwd(), "data", "guild-settings.json"),
    path.resolve(process.cwd(), "..", "..", "data", "guild-settings.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
};

const settingsFilePath = resolveSettingsFilePath();

const readStore = async (): Promise<SettingsStore> => {
  try {
    const content = await fs.readFile(settingsFilePath, "utf-8");
    const parsed = JSON.parse(content) as SettingsStore;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
};

const writeStore = async (store: SettingsStore) => {
  await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
  await fs.writeFile(settingsFilePath, JSON.stringify(store, null, 2), "utf-8");
};

export const getGuildSettings = async (guildId: string): Promise<GuildSettingsRecord> => {
  const store = await readStore();
  return store[guildId] || {};
};

export const setGuildSettings = async (
  guildId: string,
  update: GuildSettingsRecord
): Promise<GuildSettingsRecord> => {
  const store = await readStore();
  const next = {
    ...(store[guildId] || {}),
    ...update
  };
  store[guildId] = next;
  await writeStore(store);
  return next;
};

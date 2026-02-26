type SuperuserEntry = {
  user_id?: unknown;
};

const parseSuperuserIdsFromJson = () => {
  const raw = (process.env.SUPERUSERS_JSON || "").trim();
  if (!raw) {
    return [] as string[];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const candidate = entry as SuperuserEntry;
        return typeof candidate.user_id === "string" ? candidate.user_id.trim() : "";
      })
      .filter(Boolean);
  } catch {
    return [] as string[];
  }
};

export const getConfiguredSuperuserIds = () => {
  const fromJson = parseSuperuserIdsFromJson();
  const fromBypass = (process.env.DEV_BYPASS_USER_ID || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...fromJson, ...fromBypass])];
};

export const isConfiguredSuperuser = (userId: string) => {
  if (!userId) {
    return false;
  }
  return getConfiguredSuperuserIds().includes(userId);
};

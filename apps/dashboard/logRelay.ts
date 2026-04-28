import util from "node:util";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

const MAX_MESSAGE_LENGTH = 1800;
let initialized = false;
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]|(?:[\dA-PR-TZcf-nq-uy=><~]))/g;

const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");

const formatArgs = (args: unknown[]) =>
  args
    .map((arg) => {
      if (typeof arg === "string") {
        return stripAnsi(arg);
      }
      return stripAnsi(util.inspect(arg, { depth: 4, breakLength: 120 }));
    })
    .join(" ");

const splitMessage = (input: string) => {
  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += MAX_MESSAGE_LENGTH) {
    chunks.push(input.slice(index, index + MAX_MESSAGE_LENGTH));
  }
  return chunks;
};

export const initDiscordLogRelay = (
  serviceName: string,
  options: { token?: string; channelId?: string; webhookUrl?: string }
) => {
  if (initialized) {
    return;
  }
  const webhookUrl = (options.webhookUrl || "").trim();
  const token = (options.token || "").trim();
  const channelId = (options.channelId || "").trim();
  const canUseChannelFallback = Boolean(token && channelId);
  if (!webhookUrl && !canUseChannelFallback) {
    return;
  }

  initialized = true;
  const queue: string[] = [];
  let sending = false;

  const sendNext = async () => {
    if (sending || queue.length === 0) {
      return;
    }
    sending = true;
    const content = queue.shift()!;
    try {
      let delivered = false;

      if (webhookUrl) {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content })
        });
        delivered = response.ok;
      }

      if (!delivered && canUseChannelFallback) {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ content })
        });
      }
    } catch {
      // Do not log relay failures to avoid recursion.
    } finally {
      sending = false;
    }
  };

  const enqueue = (level: LogLevel, args: unknown[]) => {
    const text = formatArgs(args);
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [${serviceName}] [${level.toUpperCase()}] ${text}`;
    splitMessage(message).forEach((chunk) => queue.push(chunk));
    void sendNext();
  };

  const original: Record<LogLevel, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  (Object.keys(original) as LogLevel[]).forEach((level) => {
    console[level] = (...args: unknown[]) => {
      original[level](...args);
      enqueue(level, args);
    };
  });

  const timer = setInterval(() => {
    void sendNext();
  }, 500);
  timer.unref?.();
};


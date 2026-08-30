import { env } from "./env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = LOG_LEVELS[env.NODE_ENV === "production" ? "info" : "debug"];

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= CURRENT_LEVEL;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
      }
      if (typeof arg === "object" && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");
}

function buildMessage(level: LogLevel, args: unknown[]): string {
  return `[${formatTimestamp()}] [${level.toUpperCase()}] ${stringifyArgs(args)}`;
}

export const logger = {
  debug(...args: unknown[]) {
    if (shouldLog("debug")) {
      console.debug(buildMessage("debug", args));
    }
  },

  info(...args: unknown[]) {
    if (shouldLog("info")) {
      console.info(buildMessage("info", args));
    }
  },

  warn(...args: unknown[]) {
    if (shouldLog("warn")) {
      console.warn(buildMessage("warn", args));
    }
  },

  error(...args: unknown[]) {
    if (shouldLog("error")) {
      console.error(buildMessage("error", args));
    }
  },

  /**
   * Morgan-compatible stream (writes to logger.info).
   */
  stream: {
    write(message: string) {
      if (shouldLog("info")) {
        console.info(`[${formatTimestamp()}] [HTTP] ${message.trim()}`);
      }
    },
  },
};

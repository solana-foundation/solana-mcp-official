import { type LogLevel, serviceConfig } from "../config";

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  fatal: 1,
  error: 2,
  warn: 3,
  info: 4,
  debug: 5,
  trace: 6,
};

const currentLevel = LEVEL_ORDER[serviceConfig.logLevel] ?? LEVEL_ORDER.info;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= currentLevel;
}

type SerializableError = {
  name: string;
  message: string;
  stack: string | undefined;
  cause: unknown;
};

function safeStringify(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        } satisfies SerializableError;
      }
      return value;
    });
  } catch {
    return JSON.stringify({ event: "logger.serialization_failed" });
  }
}

export const logger = {
  fatal(obj: Record<string, unknown>): void {
    if (shouldLog("fatal")) console.error(safeStringify(obj));
  },
  error(obj: Record<string, unknown>): void {
    if (shouldLog("error")) console.error(safeStringify(obj));
  },
  warn(obj: Record<string, unknown>): void {
    if (shouldLog("warn")) console.warn(safeStringify(obj));
  },
  info(obj: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    if (shouldLog("info")) console.log(safeStringify(obj));
  },
  debug(obj: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    if (shouldLog("debug")) console.log(safeStringify(obj));
  },
  trace(obj: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    if (shouldLog("trace")) console.log(safeStringify(obj));
  },
};

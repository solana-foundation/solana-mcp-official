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

// FIXME(@rogaldh, @pashpashkin): wrap JSON.stringify in try/catch to handle circular references.
// Left as-is for easier migration; will be fixed at the end of the inspect_entity port.
export const logger = {
  fatal(obj: Record<string, unknown>): void {
    if (shouldLog("fatal")) console.error(JSON.stringify(obj));
  },
  error(obj: Record<string, unknown>): void {
    if (shouldLog("error")) console.error(JSON.stringify(obj));
  },
  warn(obj: Record<string, unknown>): void {
    if (shouldLog("warn")) console.warn(JSON.stringify(obj));
  },
  info(obj: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    if (shouldLog("info")) console.log(JSON.stringify(obj));
  },
  debug(obj: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    if (shouldLog("debug")) console.log(JSON.stringify(obj));
  },
  trace(obj: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    if (shouldLog("trace")) console.log(JSON.stringify(obj));
  },
};

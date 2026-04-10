import * as O from "fp-ts/Option";

import type { SafeNumeric } from "./types";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asSafeNumeric(value: unknown): SafeNumeric {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? value : String(value);
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export const asRecordO = (value: unknown): O.Option<Record<string, unknown>> => O.fromNullable(asRecord(value));
export const asStringO = (value: unknown): O.Option<string> => O.fromNullable(asString(value));

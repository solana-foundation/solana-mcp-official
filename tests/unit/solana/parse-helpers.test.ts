import { describe, expect, it } from "vitest";

import { asBoolean, asSafeNumeric, asRecord, asString } from "../../../lib/solana/parse-helpers";

describe("parse helpers", () => {
  it("narrows unknown to record or null", () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
    expect(asRecord("string")).toBeNull();
    expect(asRecord(42)).toBeNull();
    expect(asRecord([1, 2])).toBeNull();
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("narrows unknown to string or null", () => {
    expect(asString("ok")).toBe("ok");
    expect(asString("")).toBe("");
    expect(asString(1)).toBeNull();
    expect(asString(null)).toBeNull();
  });

  it("narrows unknown to safe numeric or null", () => {
    // numbers
    expect(asSafeNumeric(1)).toBe(1);
    expect(asSafeNumeric(0)).toBe(0);
    expect(asSafeNumeric(Number.NaN)).toBeNull();
    expect(asSafeNumeric(Infinity)).toBeNull();
    expect(asSafeNumeric("1")).toBeNull();
    // safe bigint → number
    expect(asSafeNumeric(395047597n)).toBe(395047597);
    expect(asSafeNumeric(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    // unsafe bigint → string (THE KEY NEW BEHAVIOR)
    expect(asSafeNumeric(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe("9007199254740992");
    // unsafe finite number → string
    expect(asSafeNumeric(Number.MAX_SAFE_INTEGER + 1)).toBe(String(Number.MAX_SAFE_INTEGER + 1));
    // non-integer finite number → string
    expect(asSafeNumeric(-1.5)).toBe("-1.5");
    // non-numeric → null
    expect(asSafeNumeric(null)).toBeNull();
    expect(asSafeNumeric(undefined)).toBeNull();
    expect(asSafeNumeric({})).toBeNull();
  });

  it("narrows unknown to boolean or null", () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false)).toBe(false);
    expect(asBoolean(1)).toBeNull();
    expect(asBoolean("true")).toBeNull();
    expect(asBoolean(null)).toBeNull();
  });
});

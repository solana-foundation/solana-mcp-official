import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  resolveLogLevel,
  resolveSentryEnabled,
  resolveSentryDsn,
  resolveSentryEnvironment,
  resolveSentryRelease,
  resolveSentryTracesSampleRate,
} from "../../lib/config";

describe("config resolvers", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("resolveLogLevel", () => {
    it("returns valid log level", () => {
      expect(resolveLogLevel("debug")).toBe("debug");
      expect(resolveLogLevel("error")).toBe("error");
    });

    it("falls back to info for invalid value", () => {
      expect(resolveLogLevel("invalid")).toBe("info");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back to info for undefined", () => {
      expect(resolveLogLevel(undefined)).toBe("info");
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("resolveSentryEnabled", () => {
    it("parses truthy strings", () => {
      expect(resolveSentryEnabled("true")).toBe(true);
      expect(resolveSentryEnabled("1")).toBe(true);
      expect(resolveSentryEnabled("yes")).toBe(true);
      expect(resolveSentryEnabled("on")).toBe(true);
    });

    it("parses falsy strings", () => {
      expect(resolveSentryEnabled("false")).toBe(false);
      expect(resolveSentryEnabled("0")).toBe(false);
      expect(resolveSentryEnabled("no")).toBe(false);
      expect(resolveSentryEnabled("off")).toBe(false);
    });

    it("falls back to false for invalid value", () => {
      expect(resolveSentryEnabled("maybe")).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back to false for undefined", () => {
      expect(resolveSentryEnabled(undefined)).toBe(false);
    });
  });

  describe("resolveSentryDsn", () => {
    it("returns trimmed non-empty string", () => {
      expect(resolveSentryDsn("https://sentry.io/123")).toBe("https://sentry.io/123");
    });

    it("returns undefined for empty or whitespace", () => {
      expect(resolveSentryDsn("")).toBeUndefined();
      expect(resolveSentryDsn("  ")).toBeUndefined();
      expect(resolveSentryDsn(undefined)).toBeUndefined();
    });
  });

  describe("resolveSentryEnvironment", () => {
    it("returns valid environment", () => {
      expect(resolveSentryEnvironment("production")).toBe("production");
    });

    it("falls back to development for empty", () => {
      expect(resolveSentryEnvironment("")).toBe("development");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back to development for undefined", () => {
      expect(resolveSentryEnvironment(undefined)).toBe("development");
    });
  });

  describe("resolveSentryRelease", () => {
    it("returns trimmed non-empty string", () => {
      expect(resolveSentryRelease("v1.0.0")).toBe("v1.0.0");
    });

    it("returns undefined for empty", () => {
      expect(resolveSentryRelease("")).toBeUndefined();
      expect(resolveSentryRelease(undefined)).toBeUndefined();
    });
  });

  describe("resolveSentryTracesSampleRate", () => {
    it("parses valid rate", () => {
      expect(resolveSentryTracesSampleRate("0.5")).toBe(0.5);
      expect(resolveSentryTracesSampleRate("0")).toBe(0);
      expect(resolveSentryTracesSampleRate("1")).toBe(1);
    });

    it("falls back to 0 for out-of-range", () => {
      expect(resolveSentryTracesSampleRate("2")).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back to 0 for non-numeric", () => {
      expect(resolveSentryTracesSampleRate("abc")).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back to 0 for undefined", () => {
      expect(resolveSentryTracesSampleRate(undefined)).toBe(0);
    });
  });
});

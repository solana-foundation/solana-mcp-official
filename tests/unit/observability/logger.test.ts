import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../../../lib/observability/logger";

// Default LOG_LEVEL is "info" (level 4), so fatal/error/warn/info are emitted, debug/trace are not.

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits fatal via console.error", () => {
    logger.fatal({ event: "test" });
    expect(errorSpy).toHaveBeenCalledWith('{"event":"test"}');
  });

  it("emits error via console.error", () => {
    logger.error({ event: "test" });
    expect(errorSpy).toHaveBeenCalledWith('{"event":"test"}');
  });

  it("emits warn via console.warn", () => {
    logger.warn({ event: "test" });
    expect(warnSpy).toHaveBeenCalledWith('{"event":"test"}');
  });

  it("emits info via console.log", () => {
    logger.info({ event: "test" });
    expect(logSpy).toHaveBeenCalledWith('{"event":"test"}');
  });

  it("suppresses debug at default info level", () => {
    logger.debug({ event: "test" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("suppresses trace at default info level", () => {
    logger.trace({ event: "test" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("outputs valid JSON", () => {
    logger.info({ event: "test", count: 42, nested: { ok: true } });
    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output)).toEqual({ event: "test", count: 42, nested: { ok: true } });
  });
});

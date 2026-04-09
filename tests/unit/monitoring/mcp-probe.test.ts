import { beforeAll, describe, expect, it, vi } from "vitest";

type ProbeModule = typeof import("../../../monitoring/mcp-probe/src/probe.js", {
  with: { "resolution-mode": "import" },
});
type ProbeClient = import("../../../monitoring/mcp-probe/src/probe.js", {
  with: { "resolution-mode": "import" },
}).ProbeClient;
type ProbeClientFactory = import("../../../monitoring/mcp-probe/src/probe.js", {
  with: { "resolution-mode": "import" },
}).ProbeClientFactory;
type ProbeLogRecord = import("../../../monitoring/mcp-probe/src/probe.js", {
  with: { "resolution-mode": "import" },
}).ProbeLogRecord;
type ProbeResult = import("../../../monitoring/mcp-probe/src/probe.js", {
  with: { "resolution-mode": "import" },
}).ProbeResult;

let ProbeConfigurationError: ProbeModule["ProbeConfigurationError"];
let ProbeValidationError: ProbeModule["ProbeValidationError"];
let resolveProbeConfig: ProbeModule["resolveProbeConfig"];
let runProbe: ProbeModule["runProbe"];

beforeAll(async () => {
  const probeModule = await import("../../../monitoring/mcp-probe/src/probe.js");
  ({ ProbeConfigurationError, ProbeValidationError, resolveProbeConfig, runProbe } = probeModule);
});

describe("resolveProbeConfig", () => {
  it("returns defaults when optional environment variables are unset", () => {
    const config = resolveProbeConfig({});

    expect(config).toEqual({
      targetUrl: "https://mcp.solana.com/mcp",
      maxRetries: 3,
      timeoutMs: 10000,
      backoffMs: 5000,
      minTools: 1,
    });
  });

  it("throws when a numeric environment variable is invalid", () => {
    expect(() => resolveProbeConfig({ MCP_PROBE_MAX_RETRIES: "0" })).toThrow(ProbeConfigurationError);
  });
});

describe("runProbe", () => {
  it("returns success on the first healthy attempt", async () => {
    const clientFactory = createClientFactory([
      {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [{ name: "tool-a" }, { name: "tool-b" }] }),
        close: vi.fn().mockResolvedValue(undefined),
      },
    ]);
    const log = vi.fn<(record: ProbeLogRecord) => void>();
    const now = createNowMock([0, 5, 10, 15]);

    const result = await runProbe(
      {
        targetUrl: "https://mcp.solana.com/mcp",
        maxRetries: 3,
        timeoutMs: 1000,
        backoffMs: 10,
        minTools: 1,
      },
      { clientFactory, log, now },
    );

    expect(result).toEqual({
      ok: true,
      targetUrl: "https://mcp.solana.com/mcp",
      attempts: 1,
      toolCount: 2,
      totalLatencyMs: 10,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "mcp_probe.success",
        attempt: 1,
        tool_count: 2,
      }),
    );
  });

  it("retries after a failed attempt and eventually succeeds", async () => {
    const firstClient: ProbeClient = {
      connect: vi.fn().mockRejectedValue(new Error("socket hang up")),
      listTools: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondClient: ProbeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: "tool-a" }] }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const clientFactory = createClientFactory([firstClient, secondClient]);
    const log = vi.fn<(record: ProbeLogRecord) => void>();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const now = createNowMock([0, 5, 10, 25, 35, 50]);

    const result = await runProbe(
      {
        targetUrl: "https://mcp.solana.com/mcp",
        maxRetries: 3,
        timeoutMs: 1000,
        backoffMs: 10,
        minTools: 1,
      },
      { clientFactory, log, sleep, now },
    );

    expect(result).toEqual({
      ok: true,
      targetUrl: "https://mcp.solana.com/mcp",
      attempts: 2,
      toolCount: 1,
      totalLatencyMs: 35,
    });
    expect(sleep).toHaveBeenCalledWith(10);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "mcp_probe.attempt_failed",
        attempt: 1,
        error_message: "socket hang up",
      }),
    );
  });

  it("fails after exhausting all retries", async () => {
    const clientFactory = createClientFactory([
      {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      },
      {
        connect: vi.fn().mockRejectedValue(new Error("transport offline")),
        listTools: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      },
    ]);
    const log = vi.fn<(record: ProbeLogRecord) => void>();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const now = createNowMock([0, 5, 10, 20, 30, 45, 55]);

    const result = await runProbe(
      {
        targetUrl: "https://mcp.solana.com/mcp",
        maxRetries: 2,
        timeoutMs: 1000,
        backoffMs: 10,
        minTools: 1,
      },
      { clientFactory, log, sleep, now },
    );

    expect(result).toEqual({
      ok: false,
      targetUrl: "https://mcp.solana.com/mcp",
      attempts: 2,
      totalLatencyMs: 45,
      error: "transport offline",
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "mcp_probe.hard_failure",
        attempts: 2,
        error_message: "transport offline",
      }),
    );
  });

  it("treats too few tools as a validation failure", async () => {
    const clientFactory = createClientFactory([
      {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      },
    ]);

    const result = await runProbe(
      {
        targetUrl: "https://mcp.solana.com/mcp",
        maxRetries: 1,
        timeoutMs: 1000,
        backoffMs: 10,
        minTools: 1,
      },
      {
        clientFactory,
        now: createNowMock([0, 5, 10, 15]),
      },
    );

    assertFailureResult(result);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("Expected at least 1 tool");
  });

  it("logs close failures without failing a successful probe", async () => {
    const clientFactory = createClientFactory([
      {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [{ name: "tool-a" }] }),
        close: vi.fn().mockRejectedValue(new Error("close failed")),
      },
    ]);
    const log = vi.fn<(record: ProbeLogRecord) => void>();

    const result = await runProbe(
      {
        targetUrl: "https://mcp.solana.com/mcp",
        maxRetries: 1,
        timeoutMs: 1000,
        backoffMs: 10,
        minTools: 1,
      },
      {
        clientFactory,
        log,
        now: createNowMock([0, 5, 10, 15]),
      },
    );

    expect(result.ok).toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "mcp_probe.close_failed",
        error_message: "close failed",
      }),
    );
  });

  it("uses a validation error when the returned tool count is below the threshold", async () => {
    const clientFactory = createClientFactory([
      {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      },
    ]);

    const result = await runProbe(
      {
        targetUrl: "https://mcp.solana.com/mcp",
        maxRetries: 1,
        timeoutMs: 1000,
        backoffMs: 10,
        minTools: 1,
      },
      {
        clientFactory,
        now: createNowMock([0, 5, 10, 15]),
      },
    );

    assertFailureResult(result);
    expect(() => {
      throw new ProbeValidationError(result.error);
    }).toThrow(ProbeValidationError);
  });
});

function assertFailureResult(result: ProbeResult): asserts result is Extract<ProbeResult, { ok: false }> {
  if (result.ok) {
    throw new Error("Expected failure result.");
  }
}

function createClientFactory(clients: ProbeClient[]): ProbeClientFactory {
  let index = 0;
  return () => {
    const client = clients[index];
    index += 1;
    if (!client) {
      throw new Error("No client stub left for this attempt.");
    }
    return client;
  };
}

function createNowMock(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("Ran out of mocked time values.");
    }
    return value;
  };
}

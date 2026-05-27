import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  class S3Client {
    send(command: { input: unknown }): Promise<unknown> {
      return sendMock(command);
    }
  }

  return { PutObjectCommand, S3Client };
});

interface PutObjectInput {
  Bucket?: string;
  Key?: string;
  Body?: string | Uint8Array;
  ContentType?: string;
}

function putObjectInput(callIndex = 0): PutObjectInput {
  const [command] = sendMock.mock.calls[callIndex] as [{ input: PutObjectInput }];
  return command.input;
}

function jsonlRows(input: PutObjectInput): Array<Record<string, unknown>> {
  return String(input.Body)
    .trim()
    .split("\n")
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

describe("S3 analytics service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-27T14:31:22.123Z"));
    sendMock.mockResolvedValue({});
    process.env.ANALYTICS_S3_URI = "s3://lz-solana-raw-data/mcp_analytics/";
    process.env.AWS_REGION = "us-east-1";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANALYTICS_S3_URI;
    delete process.env.ANALYTICS_S3_BATCH_SIZE;
    delete process.env.ANALYTICS_S3_MAX_BUFFERED_ROWS;
    delete process.env.ANALYTICS_S3_MAX_RECORD_AGE_MS;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_REGION;
  });

  it("skips and warns when S3 URI is missing", async () => {
    delete process.env.ANALYTICS_S3_URI;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { flushAnalytics, logInitialization } = await import("../../lib/services/s3/analytics.js");

    logInitialization({
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientName: "codex",
      clientVersion: "1.0.0",
      rawBody: {},
    });
    await flushAnalytics();

    expect(sendMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[analytics] ANALYTICS_S3_URI not set - analytics disabled");
    warnSpy.mockRestore();
  });

  it("buffers initialization rows until flush", async () => {
    const { bufferedAnalyticsRowCount, flushAnalytics, logInitialization } =
      await import("../../lib/services/s3/analytics.js");

    logInitialization({
      protocolVersion: "2025-03-26",
      capabilities: { roots: { listChanged: true } },
      clientName: "codex",
      clientVersion: "1.2.3",
      rawBody: { method: "initialize" },
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(bufferedAnalyticsRowCount()).toBe(1);

    await flushAnalytics();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const input = putObjectInput();
    expect(input.Bucket).toBe("lz-solana-raw-data");
    expect(input.Key).toMatch(
      /^mcp_analytics\/mcp_initializations\/dt=2026-05-27\/hour=14\/2026-05-27T14-31-22-123Z_[a-f0-9]{8}_000001\.jsonl$/,
    );
    expect(input.ContentType).toBe("application/x-ndjson");
    expect(jsonlRows(input)).toEqual([
      {
        schema_version: 1,
        table: "mcp_initializations",
        timestamp: "2026-05-27T14:31:22.123Z",
        method: "initialize",
        protocol_version: "2025-03-26",
        capabilities: JSON.stringify({ roots: { listChanged: true } }),
        client_name: "codex",
        client_version: "1.2.3",
        raw_body: JSON.stringify({ method: "initialize" }),
      },
    ]);
    expect(bufferedAnalyticsRowCount()).toBe(0);
  });

  it("flushes automatically when the batch size is reached", async () => {
    process.env.ANALYTICS_S3_BATCH_SIZE = "2";
    const { bufferedAnalyticsRowCount, logInitialization, logToolCallRequest } =
      await import("../../lib/services/s3/analytics.js");

    logInitialization({
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientName: "codex",
      clientVersion: "1.0.0",
      rawBody: {},
    });

    logToolCallRequest({
      toolName: "list_sections",
      requestId: "req-1",
      sessionId: "sess-1",
      toolArgs: {},
      rawBody: { id: 1 },
    });
    expect(sendMock).not.toHaveBeenCalled();

    logToolCallRequest({
      toolName: "get_documentation",
      requestId: "req-2",
      sessionId: "sess-1",
      toolArgs: { section: "core" },
      rawBody: { id: 2 },
    });

    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(bufferedAnalyticsRowCount()).toBe(1);
    const rows = jsonlRows(putObjectInput());
    expect(putObjectInput().Key).toContain("/mcp_tool_calls/");
    expect(rows.map(row => row.tool_name)).toEqual(["list_sections", "get_documentation"]);
    expect(rows.map(row => row.row_type)).toEqual(["request", "request"]);
  });

  it("flushes stale buffers opportunistically on the next enqueue", async () => {
    process.env.ANALYTICS_S3_MAX_RECORD_AGE_MS = "1000";
    const { logToolCallRequest } = await import("../../lib/services/s3/analytics.js");

    logToolCallRequest({
      toolName: "list_sections",
      requestId: "req-1",
      sessionId: null,
      toolArgs: {},
      rawBody: {},
    });
    vi.setSystemTime(new Date("2026-05-27T14:31:24.123Z"));
    logToolCallRequest({
      toolName: "get_documentation",
      requestId: "req-2",
      sessionId: null,
      toolArgs: { section: "core" },
      rawBody: {},
    });

    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(jsonlRows(putObjectInput()).map(row => row.tool_name)).toEqual(["list_sections", "get_documentation"]);
  });

  it("requeues rows when an upload fails", async () => {
    sendMock.mockRejectedValueOnce(new Error("s3 unavailable")).mockResolvedValue({});
    const { bufferedAnalyticsRowCount, flushAnalytics, logToolCallResponse } =
      await import("../../lib/services/s3/analytics.js");

    logToolCallResponse({
      tool: "Solana_Documentation_Search",
      req: "find docs",
      res: '{"content":[]}',
      rawBody: { tool: "Solana_Documentation_Search" },
    });

    await expect(flushAnalytics()).rejects.toThrow("s3 unavailable");
    expect(bufferedAnalyticsRowCount()).toBe(1);

    await flushAnalytics();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(jsonlRows(putObjectInput(1))[0]).toMatchObject({
      row_type: "response",
      tool_name: "Solana_Documentation_Search",
      arguments: JSON.stringify("find docs"),
      response_text: '{"content":[]}',
    });
    expect(bufferedAnalyticsRowCount()).toBe(0);
  });

  it("preserves failed rows over newer rows when requeue exceeds the buffer limit", async () => {
    process.env.ANALYTICS_S3_MAX_BUFFERED_ROWS = "2";
    let rejectFirstFlush: (reason: Error) => void = () => undefined;
    const firstFlush = new Promise<never>((_resolve, reject) => {
      rejectFirstFlush = reject;
    });
    sendMock.mockReturnValueOnce(firstFlush).mockResolvedValue({});
    const { flushAnalytics, logToolCallRequest } = await import("../../lib/services/s3/analytics.js");

    logToolCallRequest({
      toolName: "failed-row",
      requestId: null,
      sessionId: null,
      toolArgs: {},
      rawBody: {},
    });
    const flush = flushAnalytics();
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));

    logToolCallRequest({
      toolName: "newer-row",
      requestId: null,
      sessionId: null,
      toolArgs: {},
      rawBody: {},
    });
    logToolCallRequest({
      toolName: "newest-row",
      requestId: null,
      sessionId: null,
      toolArgs: {},
      rawBody: {},
    });

    rejectFirstFlush(new Error("s3 unavailable"));
    await expect(flush).rejects.toThrow("s3 unavailable");
    sendMock.mockClear();

    await flushAnalytics();

    const toolNames = jsonlRows(putObjectInput()).map(row => row.tool_name);
    expect(toolNames).toEqual(["failed-row", "newer-row"]);
  });
});

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Configuration for a single MCP probe execution.
 */
export type ProbeConfig = {
  /** Target MCP endpoint URL. */
  readonly targetUrl: string;
  /** Number of total attempts before the probe is considered failed. */
  readonly maxRetries: number;
  /** Timeout applied independently to connect and listTools calls. */
  readonly timeoutMs: number;
  /** Base delay between retries. Each retry waits `backoffMs * attempt`. */
  readonly backoffMs: number;
  /** Minimum number of tools expected from the MCP server. */
  readonly minTools: number;
};

/**
 * Lightweight tool shape returned by the MCP SDK.
 */
export type ProbeTool = {
  readonly name: string;
};

/**
 * Result returned by a probe client's `listTools` call.
 */
export type ProbeListToolsResult = {
  readonly tools: readonly ProbeTool[];
};

/**
 * Minimal MCP client contract required by the probe runner.
 */
export type ProbeClient = {
  connect: () => Promise<void>;
  listTools: () => Promise<ProbeListToolsResult>;
  close: () => Promise<void>;
};

/**
 * Creates a probe client for the target MCP endpoint.
 */
export type ProbeClientFactory = (targetUrl: URL) => ProbeClient;

/**
 * Structured log record emitted by the probe runner.
 */
export type ProbeLogRecord = {
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly event:
    | "mcp_probe.server_started"
    | "mcp_probe.started"
    | "mcp_probe.success"
    | "mcp_probe.attempt_failed"
    | "mcp_probe.hard_failure"
    | "mcp_probe.close_failed"
    | "mcp_probe.invalid_request"
    | "mcp_probe.request_failed";
  readonly target_url?: string;
  readonly attempt?: number;
  readonly attempts?: number;
  readonly max_retries?: number;
  readonly timeout_ms?: number;
  readonly backoff_ms?: number;
  readonly min_tools?: number;
  readonly tool_count?: number;
  readonly latency_ms?: number;
  readonly error_message?: string;
  readonly method?: string;
  readonly path?: string;
  readonly timestamp: string;
};

/**
 * Success payload returned by the probe runner.
 */
export type ProbeSuccess = {
  readonly ok: true;
  readonly targetUrl: string;
  readonly attempts: number;
  readonly toolCount: number;
  readonly totalLatencyMs: number;
};

/**
 * Failure payload returned by the probe runner.
 */
export type ProbeFailure = {
  readonly ok: false;
  readonly targetUrl: string;
  readonly attempts: number;
  readonly totalLatencyMs: number;
  readonly error: string;
};

/**
 * Result payload returned by the probe runner.
 */
export type ProbeResult = ProbeSuccess | ProbeFailure;

/**
 * Dependencies injected into the probe runner for testability.
 */
export type ProbeDependencies = {
  readonly clientFactory: ProbeClientFactory;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly timestamp?: () => string;
  readonly log?: (record: ProbeLogRecord) => void;
};

/**
 * Thrown when probe configuration is invalid.
 */
export class ProbeConfigurationError extends Error {
  name = "ProbeConfigurationError";
}

/**
 * Thrown when the MCP endpoint returns an unexpected tool list.
 */
export class ProbeValidationError extends Error {
  name = "ProbeValidationError";
}

/**
 * Resolves probe configuration from environment variables.
 *
 * @param env - Environment variables provided to the process.
 * @return Validated probe configuration.
 * @throws {ProbeConfigurationError} When any value is missing or invalid.
 */
export function resolveProbeConfig(env: NodeJS.ProcessEnv): ProbeConfig {
  return {
    targetUrl: resolveRequiredUrl(env.MCP_PROBE_TARGET_URL ?? "https://mcp.solana.com/mcp", "MCP_PROBE_TARGET_URL"),
    maxRetries: resolvePositiveInteger(env.MCP_PROBE_MAX_RETRIES, 3, "MCP_PROBE_MAX_RETRIES"),
    timeoutMs: resolvePositiveInteger(env.MCP_PROBE_TIMEOUT_MS, 10000, "MCP_PROBE_TIMEOUT_MS"),
    backoffMs: resolvePositiveInteger(env.MCP_PROBE_BACKOFF_MS, 5000, "MCP_PROBE_BACKOFF_MS"),
    minTools: resolvePositiveInteger(env.MCP_PROBE_MIN_TOOLS, 1, "MCP_PROBE_MIN_TOOLS"),
  };
}

/**
 * Executes the MCP probe with retries and structured logging.
 *
 * @param config - Probe runtime configuration.
 * @param dependencies - External dependencies for client creation and timing.
 * @return Probe result indicating success or failure.
 */
export async function runProbe(config: ProbeConfig, dependencies: ProbeDependencies): Promise<ProbeResult> {
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? Date.now;
  const timestamp = dependencies.timestamp ?? (() => new Date().toISOString());
  const log = dependencies.log ?? (() => {});
  const startedAt = now();
  const targetUrl = new URL(config.targetUrl);
  let lastErrorMessage = "Unknown probe failure";

  log({
    severity: "INFO",
    event: "mcp_probe.started",
    target_url: config.targetUrl,
    max_retries: config.maxRetries,
    timeout_ms: config.timeoutMs,
    backoff_ms: config.backoffMs,
    min_tools: config.minTools,
    timestamp: timestamp(),
  });

  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    const attemptStartedAt = now();
    const client = dependencies.clientFactory(targetUrl);

    try {
      await withTimeout(client.connect(), config.timeoutMs, `Connect timed out after ${config.timeoutMs}ms`);
      const { tools } = await withTimeout(
        client.listTools(),
        config.timeoutMs,
        `listTools timed out after ${config.timeoutMs}ms`,
      );
      const toolCount = tools.length;

      if (toolCount < config.minTools) {
        throw new ProbeValidationError(`Expected at least ${config.minTools} tool(s), received ${toolCount}.`);
      }

      const attemptEndedAt = now();
      const totalLatencyMs = attemptEndedAt - startedAt;
      const latencyMs = attemptEndedAt - attemptStartedAt;
      log({
        severity: "INFO",
        event: "mcp_probe.success",
        target_url: config.targetUrl,
        attempt,
        attempts: attempt,
        tool_count: toolCount,
        latency_ms: latencyMs,
        timestamp: timestamp(),
      });

      return {
        ok: true,
        targetUrl: config.targetUrl,
        attempts: attempt,
        toolCount,
        totalLatencyMs,
      };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      log({
        severity: "WARNING",
        event: "mcp_probe.attempt_failed",
        target_url: config.targetUrl,
        attempt,
        max_retries: config.maxRetries,
        error_message: lastErrorMessage,
        latency_ms: now() - attemptStartedAt,
        timestamp: timestamp(),
      });
    } finally {
      try {
        await client.close();
      } catch (error) {
        log({
          severity: "WARNING",
          event: "mcp_probe.close_failed",
          target_url: config.targetUrl,
          attempt,
          error_message: error instanceof Error ? error.message : String(error),
          timestamp: timestamp(),
        });
      }
    }

    if (attempt < config.maxRetries) {
      await sleep(config.backoffMs * attempt);
    }
  }

  const totalLatencyMs = now() - startedAt;
  log({
    severity: "ERROR",
    event: "mcp_probe.hard_failure",
    target_url: config.targetUrl,
    attempts: config.maxRetries,
    error_message: lastErrorMessage,
    latency_ms: totalLatencyMs,
    timestamp: timestamp(),
  });

  return {
    ok: false,
    targetUrl: config.targetUrl,
    attempts: config.maxRetries,
    totalLatencyMs,
    error: lastErrorMessage,
  };
}

/**
 * Writes a JSON response to the HTTP server.
 *
 * @param res - Node HTTP response.
 * @param statusCode - HTTP status code.
 * @param body - JSON body to serialize.
 */
export function sendJsonResponse(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

/**
 * Reads and discards a request body so the connection can be cleanly reused.
 *
 * @param req - Incoming Node HTTP request.
 */
export async function drainRequest(req: IncomingMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.on("error", reject);
    req.on("data", () => {
      // Intentionally ignored.
    });
    req.on("end", resolve);
  });
}

/**
 * Returns a structured invalid-request response and emits a log record.
 *
 * @param req - Incoming request that could not be served.
 * @param res - Outgoing response object.
 * @param log - Log sink.
 */
export async function handleInvalidRequest(
  req: IncomingMessage,
  res: ServerResponse,
  log: (record: ProbeLogRecord) => void,
): Promise<void> {
  await drainRequest(req);
  log({
    severity: "WARNING",
    event: "mcp_probe.invalid_request",
    method: req.method,
    path: req.url,
    timestamp: new Date().toISOString(),
  });
  sendJsonResponse(res, 404, { ok: false, error: "Not found" });
}

function resolveRequiredUrl(value: string, field: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new ProbeConfigurationError(`${field} must be a valid URL.`);
  }
}

function resolvePositiveInteger(value: string | undefined, fallback: number, field: string): number {
  const resolvedValue = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(resolvedValue) || resolvedValue <= 0) {
    throw new ProbeConfigurationError(`${field} must be a positive integer.`);
  }
  return resolvedValue;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

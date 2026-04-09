import { createServer, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  drainRequest,
  handleInvalidRequest,
  resolveProbeConfig,
  runProbe,
  sendJsonResponse,
  type ProbeClient,
  type ProbeLogRecord,
} from "./probe.js";

const config = resolveProbeConfig(process.env);
const port = resolvePort(process.env.PORT);

const logRecord = (record: ProbeLogRecord): void => {
  const payload = `${JSON.stringify(record)}\n`;
  if (record.severity === "ERROR" || record.severity === "WARNING") {
    process.stderr.write(payload);
    return;
  }
  process.stdout.write(payload);
};

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const path = req.url ?? "/";

  if (method === "GET" && path === "/healthz") {
    sendJsonResponse(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/run") {
    await drainRequest(req);
    await handleRunRequest(res);
    return;
  }

  await handleInvalidRequest(req, res, logRecord);
});

server.listen(port, () => {
  logRecord({
    severity: "INFO",
    event: "mcp_probe.server_started",
    target_url: config.targetUrl,
    max_retries: config.maxRetries,
    timeout_ms: config.timeoutMs,
    backoff_ms: config.backoffMs,
    min_tools: config.minTools,
    timestamp: new Date().toISOString(),
  });
});

async function handleRunRequest(res: ServerResponse): Promise<void> {
  const result = await runProbe(config, {
    clientFactory: createProbeClient,
    log: logRecord,
  });

  sendJsonResponse(res, result.ok ? 200 : 500, result);
}

function createProbeClient(targetUrl: URL): ProbeClient {
  const client = new Client(
    {
      name: "gcp-mcp-probe",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  const transport = new StreamableHTTPClientTransport(targetUrl);

  return {
    connect: async () => {
      await client.connect(transport);
    },
    listTools: async () => {
      const result = await client.listTools();
      return { tools: result.tools.map(tool => ({ name: tool.name })) };
    },
    close: async () => {
      await client.close();
    },
  };
}

function resolvePort(value: string | undefined): number {
  const resolvedValue = Number.parseInt(value ?? "8080", 10);
  if (!Number.isInteger(resolvedValue) || resolvedValue <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  return resolvedValue;
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, IncomingMessage, ServerResponse, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AddressInfo } from "node:net";
import { createMcp } from "../lib";
import type { SolanaTool } from "../lib/tools/types";
import * as generalSolanaToolsModule from "../lib/tools/generalSolanaTools";
import { geminiSolanaTools } from "../lib/tools/geminiSolanaTools";
import { solanaEcosystemTools } from "../lib/tools/ecosystemSolanaTools";
import { openAITools } from "../lib/tools/openAITools";

const hasRequiredEnv = !!process.env.REDIS_URL;
const describeE2e = hasRequiredEnv ? describe : describe.skip;

if (!hasRequiredEnv) {
  console.warn("[e2e] Skipping E2E tests — missing required env var (REDIS_URL)");
}

function resolveGeneralSolanaTools(): SolanaTool[] {
  const moduleExports = generalSolanaToolsModule as Record<string, unknown>;

  if (Array.isArray(moduleExports.generalSolanaTools)) {
    return moduleExports.generalSolanaTools as SolanaTool[];
  }

  const createSolanaTools = moduleExports.createSolanaTools;
  if (typeof createSolanaTools === "function") {
    const createdTools = (createSolanaTools as (model: unknown | null) => unknown)(null);
    if (Array.isArray(createdTools)) {
      return createdTools as SolanaTool[];
    }
  }

  return [];
}

const registeredToolNames = ([] as SolanaTool[])
  .concat(resolveGeneralSolanaTools(), geminiSolanaTools, solanaEcosystemTools, openAITools)
  .map(tool => tool.title);

describeE2e("e2e", () => {
  let server: Server;
  let endpoint: string;
  let client: Client | undefined;

  beforeEach(async () => {
    server = createServer(nodeToWebHandler(createMcp()));
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        resolve();
      });
    });

    const port = (server.address() as AddressInfo | null)?.port;
    endpoint = `http://localhost:${port}`;
    const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`));

    client = new Client(
      {
        name: "example-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );
    await client.connect(transport);
  });

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }

    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  it("lists registered tools through the MCP transport", async () => {
    const { tools } = await client!.listTools();
    const toolNames = tools.map(tool => tool.name);

    for (const toolName of registeredToolNames) {
      expect(toolNames).toContain(toolName);
    }
  });
});

function nodeToWebHandler(
  handler: (req: Request) => Promise<Response>,
): (req: IncomingMessage, res: ServerResponse) => void {
  return async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const requestBody =
      method === "GET" || method === "HEAD"
        ? undefined
        : await new Promise<ArrayBuffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", chunk => {
              chunks.push(chunk);
            });
            req.on("end", () => {
              const buf = Buffer.concat(chunks);
              resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
            });
            req.on("error", () => {
              reject(new Error("Failed to read request body"));
            });
          });

    const requestHeaders = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const val of value) {
          requestHeaders.append(key, val);
        }
      } else {
        requestHeaders.append(key, value);
      }
    }

    const reqUrl = new URL(req.url || "/", "http://localhost");
    const webReq = new Request(reqUrl, {
      method: req.method,
      headers: requestHeaders,
      body: requestBody,
    });

    const webResp = await handler(webReq);
    const responseHeaders = Object.fromEntries(webResp.headers);
    res.writeHead(webResp.status, webResp.statusText, responseHeaders);

    if (webResp.body) {
      const reader = webResp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
    }

    res.end();
  };
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    createServer,
    IncomingMessage,
    ServerResponse,
    type Server,
} from "node:http";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcp } from "../lib";
import { AddressInfo } from "node:net";
describe("e2e", () => {
    let server: Server;
    let endpoint: string;
    let client: Client;

    beforeEach(async () => {
        server = createServer(nodeToWebHandler(createMcp()));
        await new Promise<void>((resolve) => {
            server.listen(0, () => {
                resolve();
            });
        });
        const port = (server.address() as AddressInfo | null)?.port;
        endpoint = `http://localhost:${port}`;
        console.log("endpoint", endpoint);
        const transport = new StreamableHTTPClientTransport(
            new URL(`${endpoint}/mcp`)
        );
        client = new Client(
            {
                name: "example-client",
                version: "1.0.0",
            },
            {
                capabilities: {
                    prompts: {},
                    resources: {},
                    tools: {},
                },
            }
        );
        await client.connect(transport);
    });

    afterEach(async () => {
        server.close();
    });

    it("tools should include search and fetch", async () => {
        const { tools } = await client.listTools();

        const search = tools.find((tool) => tool.name === "search");
        expect(search).toBeDefined();

        const fetch = tools.find((tool) => tool.name === "fetch");
        expect(fetch).toBeDefined();
    });

    it("Search should return results as structured content", async () => {
        const result = await client.callTool(
            {
                name: "search",
                arguments: {
                    query: "How do I derive a token pda in rust?",
                },
            },
            undefined,
            {}
        );
        expect(result.structuredContent).toBeDefined();
        expect((result.structuredContent as any).results).toBeInstanceOf(Array);
        expect((result.structuredContent as any).results.length).toBeGreaterThan(0);
    });

    it("Fetch should return results as structured content", async () => {
        const result = await client.callTool(
            {
                name: "fetch",
                arguments: {
                    id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                },
            },
            undefined,
            {},
        );

        expect(result.structuredContent).toBeDefined();
        expect((result.structuredContent as any).id).toBeDefined();
        expect((result.structuredContent as any).title).toBeDefined();
        expect((result.structuredContent as any).text).toBeDefined();
        expect((result.structuredContent as any).url).toBeNull();
        expect((result.structuredContent as any).metadata).toBeNull();
    });
});

function nodeToWebHandler(
    handler: (req: Request) => Promise<Response>
): (req: IncomingMessage, res: ServerResponse) => void {
    return async (req, res) => {
        const method = (req.method || "GET").toUpperCase();
        const requestBody =
            method === "GET" || method === "HEAD"
                ? undefined
                : await new Promise<ArrayBuffer>((resolve, reject) => {
                    const chunks: Buffer[] = [];
                    req.on("data", (chunk) => {
                        chunks.push(chunk);
                    });
                    req.on("end", () => {
                        const buf = Buffer.concat(chunks);
                        resolve(
                            buf.buffer.slice(
                                buf.byteOffset,
                                buf.byteOffset + buf.byteLength
                            )
                        );
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
            const arrayBuffer = await webResp.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            res.write(buffer);
        }
        res.end();
    }
}
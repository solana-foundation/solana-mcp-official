import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { generalSolanaTools, SolanaTool } from "./tools/general_solana_tools";
import { geminiSolanaTools } from "./tools/gemini_solana_tools";
import { solanaEcosystemTools } from "./tools/ecosystem_solana_tools";
import { logAnalytics } from "../lib/analytics";
const PORT = process.env.PORT || 3001;
const app = express();
app.use(express.json());

const server = new McpServer({
  name: "solana-mcp-server",
  version: "1.0.0",
});

generalSolanaTools.forEach((tool: SolanaTool) => {
  server.tool(tool.title, tool.parameters, tool.func);
});
geminiSolanaTools.forEach((tool: SolanaTool) => {
  server.tool(tool.title, tool.parameters, tool.func);
});
solanaEcosystemTools.forEach((tool: SolanaTool) => {
  server.tool(tool.title, tool.parameters, tool.func);
});

const transports: Record<string, SSEServerTransport> = {};

app.get("/sse", async (req: Request, res: Response) => {
  try {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;

    transport.onclose = () => {
      console.log(`SSE transport closed for session ${sessionId}`);
      delete transports[sessionId];
    };

    await server.connect(transport);

    console.log(`Established SSE stream with session ID: ${sessionId}`);
  } catch (error) {
    console.error("Error establishing SSE stream:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing SSE stream");
    }
  }
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string | undefined;

  if (!sessionId) {
    console.error("No session ID provided in request URL");
    res.status(400).send("Missing sessionId parameter");
    return;
  }

  const transport = transports[sessionId];
  if (!transport) {
    console.error(`No active transport found for session ID: ${sessionId}`);
    res.status(404).send("Session not found");
    return;
  }

  try {
    const requestId = uuidv4();
    logAnalytics({
      event_type: "message_received",
      session_id: sessionId,
      request_id: requestId,
      details: { method: req.method, body: req.body },
    });
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("Error handling request:", error);
    if (!res.headersSent) {
      res.status(500).send("Error handling request");
    }
  }
});

app.listen(PORT, () => {
  console.log(`Simple SSE Server listening on port ${PORT}`);
});

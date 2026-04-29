import * as dotenv from "dotenv";

import { createMcp } from "../lib";
import { logAnalytics } from "../lib/analytics";

dotenv.config();

const mcpHandler = createMcp();

async function handler(req: Request): Promise<Response> {
  if (req.method === "POST") {
    void logIncomingRequest(req.clone());
  }
  return mcpHandler(req);
}

async function logIncomingRequest(req: Request): Promise<void> {
  try {
    const body = await req.text();
    if (!body) return;
    await logAnalytics({
      event_type: "message_received",
      session_id: req.headers.get("mcp-session-id") ?? undefined,
      details: { body },
    });
  } catch (err) {
    console.warn("[server] message_received logging failed:", err);
  }
}

export { handler as GET };
export { handler as POST };
export { handler as DELETE };

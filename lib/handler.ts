import { createMcp } from "./index";
import { logAnalytics } from "./analytics";

const mcpHandler = createMcp();

export async function handleMcpRequest(req: Request): Promise<Response> {
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
    console.warn("[handler] message_received logging failed:", err);
  }
}

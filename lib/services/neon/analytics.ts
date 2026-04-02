import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config();

const sql = process.env.POSTGRES_URL ? neon(process.env.POSTGRES_URL) : null;
if (!sql) {
  console.warn("[analytics] POSTGRES_URL not set — analytics disabled");
}

export async function logInitialization(params: {
  protocolVersion: string;
  capabilities: unknown;
  clientName: string;
  clientVersion: string;
  rawBody: unknown;
}): Promise<void> {
  if (!sql) return;

  const { protocolVersion, capabilities, clientName, clientVersion, rawBody } = params;

  await sql`
    INSERT INTO initializations (method, protocol_version, capabilities, client_name, client_version, raw_body, timestamp)
    VALUES (
      'initialize',
      ${protocolVersion},
      ${JSON.stringify(capabilities ?? null)}::jsonb,
      ${clientName},
      ${clientVersion},
      ${JSON.stringify(rawBody)}::jsonb,
      ${new Date().toISOString()}
    )
  `;
}

export async function logToolCallRequest(params: {
  toolName: string;
  requestId: string | null;
  sessionId: string | null;
  toolArgs: unknown;
  rawBody: unknown;
}): Promise<void> {
  if (!sql) return;

  const { toolName, requestId, sessionId, toolArgs, rawBody } = params;

  await sql`
    INSERT INTO tool_calls (row_type, tool_name, request_id, session_id, arguments, raw_body, timestamp)
    VALUES (
      'request',
      ${toolName},
      ${requestId},
      ${sessionId},
      ${JSON.stringify(toolArgs ?? null)}::jsonb,
      ${JSON.stringify(rawBody)}::jsonb,
      ${new Date().toISOString()}
    )
  `;
}

export function logToolCallResponse(params: { tool: string; req: string; res: string; rawBody: unknown }): void {
  if (!sql) return;

  const { tool, req, res, rawBody } = params;

  sql`
    INSERT INTO tool_calls (row_type, tool_name, arguments, response_text, raw_body, timestamp)
    VALUES (
      'response',
      ${tool},
      ${JSON.stringify(req)}::jsonb,
      ${res},
      ${JSON.stringify(rawBody)}::jsonb,
      ${new Date().toISOString()}
    )
  `
    .then(() => {})
    .catch((err: unknown) => {
      console.error("[logToolCallResponse] Error inserting tool response:", err);
    });
}

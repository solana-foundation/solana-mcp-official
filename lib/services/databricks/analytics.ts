import * as dotenv from "dotenv";
import { dbxFetch, isDatabricksConfigured } from "./client.js";

dotenv.config();

// Schema hosting the analytics tables. Table names themselves are generic
// (`mcp_initializations`, `mcp_tool_calls`); only the catalog.schema prefix
// needs to be set per deployment.
function analyticsSchema(): string | null {
  const schema = process.env.DATABRICKS_ANALYTICS_SCHEMA;
  return schema ? schema.replace(/\.$/, "") : null;
}

type SqlParamType = "STRING" | "TIMESTAMP";

interface SqlParam {
  name: string;
  value: string | null;
  type: SqlParamType;
}

interface SqlExecuteRequest {
  warehouse_id: string;
  statement: string;
  parameters: SqlParam[];
  wait_timeout: string;
}

function resolveWarehouse(): string | null {
  if (!isDatabricksConfigured()) return null;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) return null;
  return warehouseId;
}

async function executeInsert(statement: string, parameters: SqlParam[]): Promise<void> {
  const warehouseId = resolveWarehouse();
  if (!warehouseId) {
    console.warn("[analytics] Databricks env not set — analytics disabled");
    return;
  }

  const body: SqlExecuteRequest = {
    warehouse_id: warehouseId,
    statement,
    parameters,
    wait_timeout: "30s",
  };

  const res = await dbxFetch<{
    status?: { state?: string; error?: { message?: string } };
    statement_id?: string;
  }>("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const state = res.status?.state;
  if (state !== "SUCCEEDED") {
    const err = res.status?.error?.message ?? "(no error message)";
    throw new Error(`SQL statement ${res.statement_id ?? "?"} ended in state ${state ?? "?"}: ${err}`);
  }
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export async function logInitialization(params: {
  protocolVersion: string;
  capabilities: unknown;
  clientName: string;
  clientVersion: string;
  rawBody: unknown;
}): Promise<void> {
  const schema = analyticsSchema();
  if (!schema) {
    console.warn("[analytics] DATABRICKS_ANALYTICS_SCHEMA not set — analytics disabled");
    return;
  }

  const { protocolVersion, capabilities, clientName, clientVersion, rawBody } = params;

  const statement = `
    INSERT INTO ${schema}.mcp_initializations
      (timestamp, method, protocol_version, capabilities, client_name, client_version, raw_body)
    VALUES
      (CAST(:timestamp AS TIMESTAMP), :method, :protocolVersion, :capabilities, :clientName, :clientVersion, :rawBody)
  `;

  const parameters: SqlParam[] = [
    { name: "timestamp", value: new Date().toISOString(), type: "STRING" },
    { name: "method", value: "initialize", type: "STRING" },
    { name: "protocolVersion", value: protocolVersion, type: "STRING" },
    { name: "capabilities", value: stringify(capabilities), type: "STRING" },
    { name: "clientName", value: clientName, type: "STRING" },
    { name: "clientVersion", value: clientVersion, type: "STRING" },
    { name: "rawBody", value: stringify(rawBody), type: "STRING" },
  ];

  await executeInsert(statement, parameters);
}

export async function logToolCallRequest(params: {
  toolName: string;
  requestId: string | null;
  sessionId: string | null;
  toolArgs: unknown;
  rawBody: unknown;
}): Promise<void> {
  const schema = analyticsSchema();
  if (!schema) {
    console.warn("[analytics] DATABRICKS_ANALYTICS_SCHEMA not set — analytics disabled");
    return;
  }

  const { toolName, requestId, sessionId, toolArgs, rawBody } = params;

  const statement = `
    INSERT INTO ${schema}.mcp_tool_calls
      (timestamp, row_type, tool_name, request_id, session_id, arguments, raw_body)
    VALUES
      (CAST(:timestamp AS TIMESTAMP), :rowType, :toolName, :requestId, :sessionId, :arguments, :rawBody)
  `;

  const parameters: SqlParam[] = [
    { name: "timestamp", value: new Date().toISOString(), type: "STRING" },
    { name: "rowType", value: "request", type: "STRING" },
    { name: "toolName", value: toolName, type: "STRING" },
    { name: "requestId", value: requestId, type: "STRING" },
    { name: "sessionId", value: sessionId, type: "STRING" },
    { name: "arguments", value: stringify(toolArgs), type: "STRING" },
    { name: "rawBody", value: stringify(rawBody), type: "STRING" },
  ];

  await executeInsert(statement, parameters);
}

export function logToolCallResponse(params: { tool: string; req: string; res: string; rawBody: unknown }): void {
  const schema = analyticsSchema();
  if (!schema) {
    console.warn("[analytics] DATABRICKS_ANALYTICS_SCHEMA not set — analytics disabled");
    return;
  }

  const { tool, req, res, rawBody } = params;

  const statement = `
    INSERT INTO ${schema}.mcp_tool_calls
      (timestamp, row_type, tool_name, arguments, response_text, raw_body)
    VALUES
      (CAST(:timestamp AS TIMESTAMP), :rowType, :toolName, :arguments, :responseText, :rawBody)
  `;

  const parameters: SqlParam[] = [
    { name: "timestamp", value: new Date().toISOString(), type: "STRING" },
    { name: "rowType", value: "response", type: "STRING" },
    { name: "toolName", value: tool, type: "STRING" },
    { name: "arguments", value: stringify(req), type: "STRING" },
    { name: "responseText", value: res, type: "STRING" },
    { name: "rawBody", value: stringify(rawBody), type: "STRING" },
  ];

  executeInsert(statement, parameters).catch((err: unknown) => {
    console.error("[logToolCallResponse] Error inserting tool response:", err);
  });
}

import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { logInkeepToolResponse } from "./services/inkeep/analytics";

dotenv.config();

const sql = process.env.POSTGRES_URL ? neon(process.env.POSTGRES_URL) : null;
if (!sql) {
  console.warn("[analytics] POSTGRES_URL not set — analytics disabled");
}

export type EventType = "message_received" | "message_response" | "tool_call" | "tool_response";

export type AnalyticsEvent =
  | {
      event_type: Exclude<EventType, "message_response">;
      session_id?: string;
      request_id?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details?: any;
      timestamp?: string;
    }
  | {
      event_type: "message_response";
      session_id?: string;
      request_id?: string;
      details: {
        tool: string;
        req: string;
        res: string;
      };
      timestamp?: string;
    };

export async function logAnalytics(event: AnalyticsEvent) {
  if (!sql) return;

  try {
    if (event.event_type === "message_received") {
      const { body } = event.details;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        console.error("[logAnalytics] Could not parse JSON body:", body);
        return;
      }

      switch (parsedBody.method) {
        case "initialize": {
          const { protocolVersion, capabilities, clientInfo } = parsedBody.params || {};
          const clientName = clientInfo?.name || "";
          const clientVersion = clientInfo?.version || "";

          await sql`
            INSERT INTO initializations (method, protocol_version, capabilities, client_name, client_version, raw_body, timestamp)
            VALUES (
              'initialize',
              ${protocolVersion},
              ${JSON.stringify(capabilities ?? null)}::jsonb,
              ${clientName},
              ${clientVersion},
              ${JSON.stringify(parsedBody)}::jsonb,
              ${new Date().toISOString()}
            )
          `;
          break;
        }

        case "tools/call": {
          const { name, arguments: toolArgs } = parsedBody.params || {};

          await sql`
            INSERT INTO tool_calls (row_type, tool_name, request_id, session_id, arguments, raw_body, timestamp)
            VALUES (
              'request',
              ${name},
              ${event.request_id ?? null},
              ${event.session_id ?? null},
              ${JSON.stringify(toolArgs ?? null)}::jsonb,
              ${JSON.stringify(parsedBody)}::jsonb,
              ${new Date().toISOString()}
            )
          `;
          break;
        }

        default: {
          console.warn("[logAnalytics] Skipping method:", parsedBody.method);
        }
      }
    } else if (event.event_type === "message_response") {
      const { tool, req, res } = event.details;

      sql`
        INSERT INTO tool_calls (row_type, tool_name, arguments, response_text, raw_body, timestamp)
        VALUES (
          'response',
          ${tool},
          ${JSON.stringify(req)}::jsonb,
          ${res},
          ${JSON.stringify(event.details)}::jsonb,
          ${new Date().toISOString()}
        )
      `
        .then(() => {})
        .catch((err: unknown) => {
          console.error("[logAnalytics] Error inserting tool response:", err);
        });

      await logInkeepToolResponse({ tool, req, res });
    }
  } catch (err) {
    console.error("[logAnalytics] Unexpected error:", err);
  }
}

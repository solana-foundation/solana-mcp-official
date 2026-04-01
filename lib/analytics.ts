import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { logInkeepToolResponse } from "./services/inkeep/analytics";

dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: SupabaseClient<any, "public", any> | null = null;

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[analytics] Supabase credentials missing — analytics disabled");
      return null;
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
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
  const db = getSupabase();
  if (!db) return;

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

          const { error } = await db.from("initializations").insert([
            {
              method: "initialize",
              protocol_version: protocolVersion,
              capabilities,
              client_name: clientName,
              client_version: clientVersion,
              raw_body: parsedBody,
              timestamp: new Date().toISOString(),
            },
          ]);

          if (error) console.error("[logAnalytics] Error inserting initialize:", error);
          break;
        }

        case "tools/call": {
          const { name, arguments: toolArgs } = parsedBody.params || {};

          const { error } = await db.from("tool_calls").insert([
            {
              row_type: "request",
              tool_name: name,
              request_id: event.request_id,
              session_id: event.session_id,
              arguments: toolArgs,
              raw_body: parsedBody,
              timestamp: new Date().toISOString(),
            },
          ]);

          if (error) console.error("[logAnalytics] Error inserting tool_call:", error);
          break;
        }

        default: {
          console.warn("[logAnalytics] Skipping method:", parsedBody.method);
        }
      }
    } else if (event.event_type === "message_response") {
      const { tool, req, res } = event.details;

      db.from("tool_calls")
        .insert([
          {
            row_type: "response",
            tool_name: tool,
            arguments: req,
            response_text: res,
            raw_body: event.details,
            timestamp: new Date().toISOString(),
          },
        ])
        .then(
          ({ error }) => {
            if (error) {
              console.error("[logAnalytics] Error inserting tool response:", error);
            }
          },
          err => {
            console.error("[logAnalytics] Network error inserting tool response:", err);
          },
        );

      await logInkeepToolResponse({ tool, req, res });
    }
  } catch (err) {
    console.error("[logAnalytics] Unexpected error:", err);
  }
}

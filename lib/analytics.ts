import { createClient } from "@supabase/supabase-js";
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase credentials are missing");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export type AnalyticsEvent = {
  event_type: string;
  session_id?: string;
  request_id?: string;
  details?: any;
  timestamp?: string;
};

export async function logAnalytics(event: AnalyticsEvent) {
  try {
    if (event.event_type === "message_received") {
      const { body } = event.details;
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(body);
      } catch (err) {
        console.error("[logAnalytics] Could not parse JSON body:", body);
        return;
      }

      switch (parsedBody.method) {
        case "initialize": {
          const { protocolVersion, capabilities, clientInfo } =
            parsedBody.params || {};
          const clientName = clientInfo?.name || "";
          const clientVersion = clientInfo?.version || "";

          const { data, error } = await supabase
            .from("initializations")
            .insert([
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

          if (error)
            console.error("[logAnalytics] Error inserting initialize:", error);
          break;
        }

        case "tools/call": {
          const { name, arguments: toolArgs } = parsedBody.params || {};

          const { data, error } = await supabase.from("tool_calls").insert([
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

          if (error)
            console.error("[logAnalytics] Error inserting tool_call:", error);
          break;
        }

        default: {
          console.log("[logAnalytics] Skipping method:", parsedBody.method);
        }
      }
    } else if (event.event_type === "message_response") {
      const { tool, req, res } = event.details;

      const { data, error } = await supabase.from("tool_calls").insert([
        {
          row_type: "response",
          tool_name: tool,
          arguments: req,
          response_text: res,
          raw_body: event.details,
          timestamp: new Date().toISOString(),
        },
      ]);

      if (error)
        console.error("[logAnalytics] Error inserting tool response:", error);
    }
  } catch (err) {
    console.error("[logAnalytics] Unexpected error:", err);
  }
}

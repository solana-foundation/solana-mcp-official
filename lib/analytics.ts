import * as neonAnalytics from "./services/neon/analytics";
import * as databricksAnalytics from "./services/databricks/analytics";
import { logInkeepToolResponse } from "./services/inkeep/analytics";
import { useDatabricks } from "./flags";

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

type AnalyticsSink = {
  logInitialization: typeof neonAnalytics.logInitialization;
  logToolCallRequest: typeof neonAnalytics.logToolCallRequest;
  logToolCallResponse: typeof neonAnalytics.logToolCallResponse;
};

function analyticsSink(): AnalyticsSink {
  return useDatabricks() ? databricksAnalytics : neonAnalytics;
}

export async function logAnalytics(event: AnalyticsEvent) {
  try {
    const sink = analyticsSink();

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
          await sink.logInitialization({
            protocolVersion,
            capabilities,
            clientName: clientInfo?.name || "",
            clientVersion: clientInfo?.version || "",
            rawBody: parsedBody,
          });
          break;
        }

        case "tools/call": {
          const { name, arguments: toolArgs } = parsedBody.params || {};
          await sink.logToolCallRequest({
            toolName: name,
            requestId: event.request_id ?? null,
            sessionId: event.session_id ?? null,
            toolArgs,
            rawBody: parsedBody,
          });
          break;
        }

        default: {
          console.warn("[logAnalytics] Skipping method:", parsedBody.method);
        }
      }
    } else if (event.event_type === "message_response") {
      const { tool, req, res } = event.details;
      sink.logToolCallResponse({ tool, req, res, rawBody: event.details });

      if (!useDatabricks()) {
        await logInkeepToolResponse({ tool, req, res });
      }
    }
  } catch (err) {
    console.error("[logAnalytics] Unexpected error:", err);
  }
}

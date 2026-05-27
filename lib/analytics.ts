import * as databricksAnalytics from "./services/databricks/analytics";

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

function programAutofixerRequestMetadata(toolArgs: unknown): Record<string, unknown> {
  if (!toolArgs || typeof toolArgs !== "object") {
    return {
      framework_requested: "auto",
      code_length: null,
      has_code: false,
    };
  }

  const args = toolArgs as Record<string, unknown>;
  const framework = typeof args.framework === "string" ? args.framework : "auto";
  const code = typeof args.code === "string" ? args.code : null;
  return {
    framework_requested: framework,
    code_length: code?.length ?? null,
    has_code: code !== null,
  };
}

function sanitizeToolArgs(toolName: string, toolArgs: unknown): unknown {
  if (toolName !== "program_autofixer") return toolArgs;
  return programAutofixerRequestMetadata(toolArgs);
}

function sanitizeToolCallRawBody(parsedBody: unknown, sanitizedArgs: unknown): unknown {
  if (!parsedBody || typeof parsedBody !== "object") return parsedBody;
  const body = parsedBody as Record<string, unknown>;
  if (body.method !== "tools/call") return parsedBody;
  const params = body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : {};
  if (params.name !== "program_autofixer") return parsedBody;
  return {
    ...body,
    params: {
      ...params,
      arguments: sanitizedArgs,
    },
  };
}

export async function logAnalytics(event: AnalyticsEvent) {
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
          await databricksAnalytics.logInitialization({
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
          const toolName = typeof name === "string" ? name : "";
          const sanitizedArgs = sanitizeToolArgs(toolName, toolArgs);
          await databricksAnalytics.logToolCallRequest({
            toolName,
            requestId: event.request_id ?? null,
            sessionId: event.session_id ?? null,
            toolArgs: sanitizedArgs,
            rawBody: sanitizeToolCallRawBody(parsedBody, sanitizedArgs),
          });
          break;
        }

        default: {
          console.warn("[logAnalytics] Skipping method:", parsedBody.method);
        }
      }
    } else if (event.event_type === "message_response") {
      const { tool, req, res } = event.details;
      databricksAnalytics.logToolCallResponse({ tool, req, res, rawBody: event.details });
    }
  } catch (err) {
    console.error("[logAnalytics] Unexpected error:", err);
  }
}

export async function flushAnalytics(): Promise<void> {
  await databricksAnalytics.flushAnalytics();
}

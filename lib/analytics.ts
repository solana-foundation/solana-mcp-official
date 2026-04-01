import { createClient } from "@supabase/supabase-js";
import { InkeepAnalytics } from "@inkeep/inkeep-analytics";
import type {
  CreateOpenAIConversation,
  Messages,
  UserProperties,
} from "@inkeep/inkeep-analytics/models/components";
import * as dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase credentials are missing");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export type EventType = "message_received" | "message_response" | "tool_call" | "tool_response";

export type AnalyticsEvent =
  | {
      event_type: Exclude<EventType, "message_response">;
      session_id?: string;
      request_id?: string;
      details?: unknown;
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
  try {
    if (event.event_type === "message_received") {
      const body = getMessageBody(event.details);
      if (!body) {
        console.error("[logAnalytics] Missing body on message_received event");
        return;
      }

      let parsedBody: ParsedBody;
      try {
        parsedBody = JSON.parse(body) as ParsedBody;
      } catch {
        console.error("[logAnalytics] Could not parse JSON body:", body);
        return;
      }

      switch (parsedBody.method) {
        case "initialize": {
          const { protocolVersion, capabilities, clientInfo } = parsedBody.params || {};
          const clientName = typeof clientInfo?.name === "string" ? clientInfo.name : "";
          const clientVersion = typeof clientInfo?.version === "string" ? clientInfo.version : "";

          const { error } = await supabase.from("initializations").insert([
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

          const { error } = await supabase.from("tool_calls").insert([
            {
              row_type: "request",
              tool_name: typeof name === "string" ? name : "",
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
          console.log(
            "[logAnalytics] Skipping method:",
            typeof parsedBody.method === "string" ? parsedBody.method : "unknown",
          );
        }
      }
    } else if (event.event_type === "message_response") {
      const { tool, req, res } = event.details;

      supabase
        .from("tool_calls")
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
        .then(({ error }) => {
          if (error) {
            console.error("[logAnalytics] Error inserting tool response:", error);
          }
        });

      const parsedRes = JSON.parse(res) as {
        content?: Array<{
          title?: unknown;
          url?: unknown;
        }>;
      };
      // Formatting of log data from https://github.com/inkeep/mcp-for-vercel/blob/main/app/%5Btransport%5D/route.ts#L98
      const links =
        (parsedRes.content ?? [])
          .filter(
            (contentItem): contentItem is { title?: unknown; url: string } =>
              typeof contentItem.url === "string" && contentItem.url.length > 0,
          )
          .map((contentItem) => {
            const title =
              typeof contentItem.title === "string" && contentItem.title.length > 0
                ? contentItem.title
                : contentItem.url;
            return `- [${title}](${contentItem.url})`;
          })
          .join("\n") || "";

      await logToInkeepAnalytics({
        properties: {
          tool,
        },
        messagesToLogToAnalytics: [
          {
            role: "user",
            content: req,
          },
          {
            role: "assistant",
            content: links,
          },
        ],
      });
    }
  } catch (err) {
    console.error("[logAnalytics] Unexpected error:", err);
  }
}

async function logToInkeepAnalytics({
  messagesToLogToAnalytics,
  properties,
  userProperties,
}: {
  messagesToLogToAnalytics: Messages[];
  properties?: Record<string, unknown> | null | undefined;
  userProperties?: UserProperties | null | undefined;
}): Promise<void> {
  const apiIntegrationKey = process.env.INKEEP_API_KEY;

  const inkeepAnalytics = new InkeepAnalytics({ apiIntegrationKey });

  const logConversationPayload: CreateOpenAIConversation = {
    type: "openai",
    messages: messagesToLogToAnalytics,
    userProperties,
    properties,
  };

  try {
    await inkeepAnalytics.conversations.log(
      {
        apiIntegrationKey,
      },
      logConversationPayload,
    );
  } catch (raceError) {
    console.error("Error logging conversation", raceError);
  }
}

type ParsedBody = {
  method?: string;
  params?: {
    arguments?: unknown;
    capabilities?: unknown;
    clientInfo?: {
      name?: unknown;
      version?: unknown;
    };
    name?: unknown;
    protocolVersion?: unknown;
  };
};

function getMessageBody(details: unknown): string | null {
  if (!details || typeof details !== "object") {
    return null;
  }

  const maybeBody = (details as { body?: unknown }).body;
  if (typeof maybeBody !== "string") {
    return null;
  }

  return maybeBody;
}

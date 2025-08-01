import { createClient } from "@supabase/supabase-js";
import { InkeepAnalytics } from '@inkeep/inkeep-analytics';
import type { CreateOpenAIConversation, Messages, UserProperties } from '@inkeep/inkeep-analytics/models/components';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase credentials are missing");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export type EventType = 'message_received' | 'message_response' | 'tool_call' | 'tool_response';

export type AnalyticsEvent =
  | {
    event_type: Exclude<EventType, 'message_response'>;
    session_id?: string;
    request_id?: string;
    details?: any;
    timestamp?: string;
  }
  | {
    event_type: 'message_response';
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
  console.log("Logging analytics", event);
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

      supabase.from("tool_calls").insert([
        {
          row_type: "response",
          tool_name: tool,
          arguments: req,
          response_text: res,
          raw_body: event.details,
          timestamp: new Date().toISOString(),
        },
      ]).then(({ error }) => {
        if (error) {
          console.error("[logAnalytics] Error inserting tool response:", error);
        }
      });

      const parsedRes = JSON.parse(res);
      // Formatting of log data from https://github.com/inkeep/mcp-for-vercel/blob/main/app/%5Btransport%5D/route.ts#L98 
      const links = parsedRes['content']
        .filter((x: any) => x['url'])
        .map((x: any) => `- [${x['title'] || x['url']}](${x['url']})`)
        .join("\n") || '';

      logToInkeepAnalytics({
        properties: {
          tool: 'search-solana-docs',
        },
        messagesToLogToAnalytics: [
          {
            role: "user",
            content: req,
          },
          {
            role: "assistant",
            content: links,
          }
        ],
      });
      console.log("Logged conversation to Inkeep Analytics");

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
  properties?: { [k: string]: any } | null | undefined;
  userProperties?: UserProperties | null | undefined;
}): Promise<void> {
  try {
    const apiIntegrationKey = process.env.INKEEP_API_KEY;

    const inkeepAnalytics = new InkeepAnalytics({ apiIntegrationKey });

    const logConversationPayload: CreateOpenAIConversation = {
      type: 'openai',
      messages: messagesToLogToAnalytics,
      userProperties,
      properties,
    };

    console.log("Logging to Inkeep Analytics", logConversationPayload);

    // Add timeout to detect hanging promises
    // Use AbortController to abort the inkeepAnalytics promise after 3s
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("Timed out after 3s, aborting Inkeep Analytics request");
      abortController.abort();
    }, 3000);

    try {
      console.log('Starting Promise.race...');
      const startTime = Date.now();

      const inkeepPromise = inkeepAnalytics.conversations.log(
        {
          apiIntegrationKey,
        },
        logConversationPayload,
        { signal: abortController.signal }
      ).then(() => {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;
        console.log(`Successfully logged to Inkeep Analytics (took ${elapsed}ms)`);
        return 'success';
      }).catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.error('Inkeep Analytics request was aborted due to timeout');
        } else {
          console.error('Inkeep Analytics error:', err);
        }
        throw err;
      });
    } catch (raceError) {
      console.error('Promise.race error:', raceError);
      throw raceError;
    }
    // .then(() => {
    //   console.log('Logged conversation to Inkeep Analytics');
    // }).catch((err) => {
    //   console.error('Error logging conversation', err);
    // });
    // console.log("Logging...");
  } catch (err) {
    console.error('Error logging conversation', err);
  }
}
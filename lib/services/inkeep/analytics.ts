import { InkeepAnalytics } from "@inkeep/inkeep-analytics";
import type { CreateOpenAIConversation, Messages, UserProperties } from "@inkeep/inkeep-analytics/models/components";

let keyWarningLogged = false;

export async function logInkeepToolResponse({
  tool,
  req,
  res,
}: {
  tool: string;
  req: string;
  res: string;
}): Promise<void> {
  const apiIntegrationKey = process.env.INKEEP_API_KEY;
  if (!apiIntegrationKey) {
    if (!keyWarningLogged) {
      console.warn("[logToInkeepAnalytics] INKEEP_API_KEY not set, skipping Inkeep analytics");
      keyWarningLogged = true;
    }
    return;
  }

  let parsedRes: unknown;
  try {
    parsedRes = JSON.parse(res);
  } catch (err) {
    console.warn("[logInkeepToolResponse] Failed to parse response JSON, skipping Inkeep analytics", err);
    return;
  }

  const content =
    typeof parsedRes === "object" &&
    parsedRes !== null &&
    "content" in parsedRes &&
    Array.isArray((parsedRes as { content?: unknown }).content)
      ? (parsedRes as { content: unknown[] }).content
      : [];

  // Formatting of log data from https://github.com/inkeep/mcp-for-vercel/blob/main/app/%5Btransport%5D/route.ts#L98
  const links =
    content
      .filter(
        (item): item is { url: string; title?: unknown } =>
          typeof item === "object" &&
          item !== null &&
          "url" in item &&
          typeof (item as { url?: unknown }).url === "string" &&
          (item as { url: string }).url.length > 0,
      )
      .map(item => {
        const title = typeof item.title === "string" && item.title.length > 0 ? item.title : item.url;
        return `- [${title}](${item.url})`;
      })
      .join("\n") || "";

  await logToInkeepAnalytics({
    apiIntegrationKey,
    properties: { tool },
    messagesToLogToAnalytics: [
      { role: "user", content: req },
      { role: "assistant", content: links },
    ],
  });
}

async function logToInkeepAnalytics({
  apiIntegrationKey,
  messagesToLogToAnalytics,
  properties,
  userProperties,
}: {
  apiIntegrationKey: string;
  messagesToLogToAnalytics: Messages[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: { [k: string]: any } | null | undefined;
  userProperties?: UserProperties | null | undefined;
}): Promise<void> {
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
  } catch (err) {
    console.error("[logToInkeepAnalytics] Error logging conversation", err);
  }
}

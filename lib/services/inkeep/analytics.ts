import { InkeepAnalytics } from '@inkeep/inkeep-analytics';
import type { CreateOpenAIConversation, Messages, UserProperties } from '@inkeep/inkeep-analytics/models/components';

let keyWarningLogged = false;

export async function logInkeepToolResponse({ tool, req, res }: { tool: string; req: string; res: string }): Promise<void> {
  const parsedRes = JSON.parse(res);
  // Formatting of log data from https://github.com/inkeep/mcp-for-vercel/blob/main/app/%5Btransport%5D/route.ts#L98
  const links = parsedRes['content']
    .filter((x: any) => x['url'])
    .map((x: any) => `- [${x['title'] || x['url']}](${x['url']})`)
    .join("\n") || '';

  await logToInkeepAnalytics({
    properties: { tool },
    messagesToLogToAnalytics: [
      { role: "user", content: req },
      { role: "assistant", content: links },
    ],
  });
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
  const apiIntegrationKey = process.env.INKEEP_API_KEY;

  if (!apiIntegrationKey) {
    if (!keyWarningLogged) {
      console.warn("[logToInkeepAnalytics] INKEEP_API_KEY not set, skipping Inkeep analytics");
      keyWarningLogged = true;
    }
    return;
  }

  const inkeepAnalytics = new InkeepAnalytics({ apiIntegrationKey });

  const logConversationPayload: CreateOpenAIConversation = {
    type: 'openai',
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
    )
  } catch (err) {
    console.error('[logToInkeepAnalytics] Error logging conversation', err);
  }
}

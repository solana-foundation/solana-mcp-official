import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as generalSolanaToolsModule from "../lib/tools/generalSolanaTools";
import type { SolanaTool } from "../lib/tools/types";

const { createMcpHandlerMock } = vi.hoisted(() => ({
  createMcpHandlerMock: vi.fn(),
}));

vi.mock("mcp-handler", () => ({
  createMcpHandler: createMcpHandlerMock,
}));

import { createMcp } from "../lib";

type InitializeServer = (server: {
  registerTool: (...args: unknown[]) => unknown;
  tool: (...args: unknown[]) => unknown;
  prompt: (...args: unknown[]) => unknown;
}) => Promise<void> | void;

type PromptResult = {
  messages: Array<{
    role: string;
    content: {
      type: string;
      text: string;
    };
  }>;
};

function resolveGeneralSolanaTools(): SolanaTool[] {
  const moduleExports = generalSolanaToolsModule as Record<string, unknown>;

  if (Array.isArray(moduleExports.generalSolanaTools)) {
    return moduleExports.generalSolanaTools as SolanaTool[];
  }

  const createSolanaTools = moduleExports.createSolanaTools;
  if (typeof createSolanaTools === "function") {
    const createdTools = (createSolanaTools as (model: unknown | null) => unknown)(null);
    if (Array.isArray(createdTools)) {
      return createdTools as SolanaTool[];
    }
  }

  return [];
}

const allTools: SolanaTool[] = resolveGeneralSolanaTools();

describe("createMcp", () => {
  beforeEach(() => {
    createMcpHandlerMock.mockReset();
    createMcpHandlerMock.mockReturnValue(vi.fn());
  });

  it("configures the MCP adapter with the expected options", () => {
    const previousRedisUrl = process.env.REDIS_URL;
    const requestHandler = vi.fn();
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    createMcpHandlerMock.mockReturnValue(requestHandler);

    try {
      const handler = createMcp();
      expect(handler).toBe(requestHandler);
    } finally {
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }

    expect(createMcpHandlerMock).toHaveBeenCalledTimes(1);
    const [initializeServer, serverOptions, config] = createMcpHandlerMock.mock.calls[0] as [
      InitializeServer,
      {
        capabilities: Record<string, never>;
      },
      {
        basePath: string;
        redisUrl?: string;
        disableSse: boolean;
        maxDuration: number;
        verboseLogs: boolean;
      },
    ];

    expect(typeof initializeServer).toBe("function");
    expect(serverOptions).toEqual({ capabilities: {} });
    expect(config).toEqual({
      basePath: "",
      redisUrl: "redis://127.0.0.1:6379",
      disableSse: false,
      maxDuration: 120,
      verboseLogs: true,
    });
  });

  it("disables SSE when no REDIS_URL is set", () => {
    const previousRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    createMcpHandlerMock.mockReturnValue(vi.fn());

    try {
      createMcp();
    } finally {
      if (previousRedisUrl !== undefined) process.env.REDIS_URL = previousRedisUrl;
    }

    const [, , config] = createMcpHandlerMock.mock.calls[0] as [
      unknown,
      unknown,
      { disableSse: boolean; redisUrl?: string },
    ];
    expect(config.disableSse).toBe(true);
    expect(config.redisUrl).toBeUndefined();
  });

  it("registers tools and startup prompt", async () => {
    createMcp();
    const [initializeServer] = createMcpHandlerMock.mock.calls[0] as [InitializeServer];

    const registerToolMock = vi.fn();
    const toolMock = vi.fn();
    const promptMock = vi.fn();
    const server = {
      registerTool: registerToolMock,
      tool: toolMock,
      prompt: promptMock,
    };

    await initializeServer(server);

    const toolsViaRegisterTool = allTools.filter(t => t.outputSchema !== undefined || t.annotations !== undefined);
    const toolsViaTool = allTools.filter(t => t.outputSchema === undefined && t.annotations === undefined);

    expect(registerToolMock).toHaveBeenCalledTimes(toolsViaRegisterTool.length);
    expect(toolMock).toHaveBeenCalledTimes(toolsViaTool.length);

    const registerToolCalls = registerToolMock.mock.calls as Array<
      [
        string,
        {
          description: string;
          inputSchema: unknown;
          outputSchema: unknown;
          annotations: Record<string, unknown>;
        },
        unknown,
      ]
    >;
    for (const tool of toolsViaRegisterTool) {
      const matchingCall = registerToolCalls.find(([name]) => name === tool.title);
      expect(matchingCall).toBeDefined();
      if (!matchingCall) {
        continue;
      }

      const [, options, handler] = matchingCall;
      expect(options.description).toBe(tool.description ?? "");
      expect(options.inputSchema).toBeDefined();
      if (tool.outputSchema) {
        expect(options.outputSchema).toBeDefined();
      }
      expect(options.annotations).toEqual(tool.annotations ?? {});
      expect(typeof handler).toBe("function");
    }

    const toolCalls = toolMock.mock.calls as Array<[string, string, unknown, unknown]>;
    for (const tool of toolsViaTool) {
      const matchingCall = toolCalls.find(([name]) => name === tool.title);
      expect(matchingCall).toBeDefined();
      if (!matchingCall) {
        continue;
      }

      const [, description, inputSchema, handler] = matchingCall;
      expect(description).toBe(tool.description ?? "");
      expect(inputSchema).toBeDefined();
      expect(typeof handler).toBe("function");
    }

    expect(promptMock).toHaveBeenCalledTimes(1);
    const [promptName, promptSchema, promptHandler] = promptMock.mock.calls[0] as [
      string,
      { code: z.ZodString },
      (_args: { code: string }) => PromptResult,
    ];

    expect(promptName).toContain("IMPORTANT");
    expect(promptSchema.code.safeParse("anchor init").success).toBe(true);

    const promptResult = promptHandler({ code: "anchor init" });
    expect(promptResult.messages).toHaveLength(1);
    expect(promptResult.messages[0]).toMatchObject({
      role: "user",
      content: { type: "text" },
    });
    expect(promptResult.messages[0].content.text).toContain("Solana_Documentation_Search");
    expect(promptResult.messages[0].content.text).toContain("list_sections");
    expect(promptResult.messages[0].content.text).toContain("get_documentation");
  });
});

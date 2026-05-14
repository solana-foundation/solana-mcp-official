import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMcpMock, requestHandlerMock, dotenvConfigMock, logAnalyticsMock } = vi.hoisted(() => {
  const requestHandlerMock = vi.fn();
  return {
    createMcpMock: vi.fn(() => requestHandlerMock),
    requestHandlerMock,
    dotenvConfigMock: vi.fn(),
    logAnalyticsMock: vi.fn(),
  };
});

vi.mock("../../lib", () => ({
  createMcp: createMcpMock,
}));

vi.mock("../../lib/analytics", () => ({
  logAnalytics: logAnalyticsMock,
}));

vi.mock("dotenv", () => ({
  config: dotenvConfigMock,
}));

import { handleMcpRequest } from "../../lib/handler";

describe("handleMcpRequest", () => {
  beforeEach(() => {
    requestHandlerMock.mockReset();
    requestHandlerMock.mockResolvedValue(new Response("ok"));
    logAnalyticsMock.mockReset();
    logAnalyticsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("instantiates the MCP handler exactly once at module load", () => {
    expect(createMcpMock).toHaveBeenCalledTimes(1);
  });

  it("delegates GET, POST, and DELETE requests to the same underlying handler", async () => {
    const getReq = new Request("http://localhost/mcp", { method: "GET" });
    const postReq = new Request("http://localhost/mcp", { method: "POST", body: "{}" });
    const deleteReq = new Request("http://localhost/mcp", { method: "DELETE" });

    await handleMcpRequest(getReq);
    await handleMcpRequest(postReq);
    await handleMcpRequest(deleteReq);

    expect(requestHandlerMock).toHaveBeenNthCalledWith(1, getReq);
    expect(requestHandlerMock).toHaveBeenNthCalledWith(2, postReq);
    expect(requestHandlerMock).toHaveBeenNthCalledWith(3, deleteReq);
  });

  it("emits a `message_received` analytics event for POST requests with a body", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      body,
      headers: { "mcp-session-id": "sess-1" },
    });

    await handleMcpRequest(req);
    await new Promise(resolve => setImmediate(resolve));

    expect(logAnalyticsMock).toHaveBeenCalledTimes(1);
    expect(logAnalyticsMock).toHaveBeenCalledWith({
      event_type: "message_received",
      session_id: "sess-1",
      details: { body },
    });
  });

  it("does not emit analytics for GET or DELETE requests", async () => {
    await handleMcpRequest(new Request("http://localhost/mcp", { method: "GET" }));
    await handleMcpRequest(new Request("http://localhost/mcp", { method: "DELETE" }));
    await new Promise(resolve => setImmediate(resolve));
    expect(logAnalyticsMock).not.toHaveBeenCalled();
  });

  it("skips analytics for POST requests with an empty body", async () => {
    const req = new Request("http://localhost/mcp", { method: "POST", body: "" });
    await handleMcpRequest(req);
    await new Promise(resolve => setImmediate(resolve));
    expect(logAnalyticsMock).not.toHaveBeenCalled();
  });

  it("does not block the response when logAnalytics throws", async () => {
    logAnalyticsMock.mockRejectedValueOnce(new Error("warehouse unavailable"));
    const req = new Request("http://localhost/mcp", { method: "POST", body: "{}" });
    const res = await handleMcpRequest(req);
    expect(res).toBeInstanceOf(Response);
  });
});

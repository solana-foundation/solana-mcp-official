import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMcpMock, requestHandlerMock, dotenvConfigMock } = vi.hoisted(() => {
  const requestHandlerMock = vi.fn();
  return {
    createMcpMock: vi.fn(() => requestHandlerMock),
    requestHandlerMock,
    dotenvConfigMock: vi.fn(),
  };
});

vi.mock("../../lib", () => ({
  createMcp: createMcpMock,
}));

vi.mock("dotenv", () => ({
  config: dotenvConfigMock,
}));

import { DELETE, GET, POST } from "../../api/server";

describe("api server handler", () => {
  beforeEach(() => {
    createMcpMock.mockClear();
    requestHandlerMock.mockReset();
    requestHandlerMock.mockResolvedValue(new Response("ok"));
  });

  it("delegates GET, POST, and DELETE requests to createMcp handler", async () => {
    const getReq = new Request("http://localhost/mcp", { method: "GET" });
    const postReq = new Request("http://localhost/mcp", { method: "POST", body: "{}" });
    const deleteReq = new Request("http://localhost/mcp", { method: "DELETE" });

    await GET(getReq);
    await POST(postReq);
    await DELETE(deleteReq);

    expect(createMcpMock).toHaveBeenCalledTimes(3);
    expect(requestHandlerMock).toHaveBeenNthCalledWith(1, getReq);
    expect(requestHandlerMock).toHaveBeenNthCalledWith(2, postReq);
    expect(requestHandlerMock).toHaveBeenNthCalledWith(3, deleteReq);
  });
});

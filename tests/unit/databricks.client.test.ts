import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://dbc-test.cloud.databricks.com";
const TOKEN = "dapi-test-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

describe("databricks client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    process.env.DATABRICKS_HOST = HOST;
    process.env.DATABRICKS_TOKEN = TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;
  });

  describe("isDatabricksConfigured", () => {
    it("returns false when host or token missing", async () => {
      delete process.env.DATABRICKS_HOST;
      const { isDatabricksConfigured } = await import("../../lib/services/databricks/client.js");
      expect(isDatabricksConfigured()).toBe(false);
    });

    it("returns true when both set", async () => {
      const { isDatabricksConfigured } = await import("../../lib/services/databricks/client.js");
      expect(isDatabricksConfigured()).toBe(true);
    });
  });

  describe("dbxFetch", () => {
    it("throws when env vars missing", async () => {
      delete process.env.DATABRICKS_TOKEN;
      const { dbxFetch } = await import("../../lib/services/databricks/client.js");
      await expect(dbxFetch("/anything")).rejects.toThrow(/not configured/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends bearer auth and parses JSON on success", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, n: 42 }));
      const { dbxFetch } = await import("../../lib/services/databricks/client.js");

      const result = await dbxFetch<{ n: number }>("/api/2.0/thing", {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
      });

      expect(result).toEqual({ ok: true, n: 42 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${HOST}/api/2.0/thing`);
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
      expect(headers.get("Content-Type")).toBe("application/json");
    });

    it("normalizes trailing slash on host and leading slash on path", async () => {
      process.env.DATABRICKS_HOST = `${HOST}/`;
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const { dbxFetch } = await import("../../lib/services/databricks/client.js");

      await dbxFetch("api/2.0/ping");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${HOST}/api/2.0/ping`);
    });

    it("retries on 429 then succeeds", async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse("rate limited", 429))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const { dbxFetch } = await import("../../lib/services/databricks/client.js");
      const promise = dbxFetch<{ ok: boolean }>("/api/2.0/retry", { method: "GET" });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries on 500 then succeeds", async () => {
      fetchMock.mockResolvedValueOnce(textResponse("boom", 500)).mockResolvedValueOnce(jsonResponse({ ok: true }));

      const { dbxFetch } = await import("../../lib/services/databricks/client.js");
      const promise = dbxFetch("/api/2.0/flaky", { method: "GET" });
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws DatabricksError after exhausting retries on 500", async () => {
      fetchMock.mockImplementation(async () => textResponse("persistent failure body", 500));

      const { dbxFetch, DatabricksError } = await import("../../lib/services/databricks/client.js");
      const promise = dbxFetch("/api/2.0/never", { method: "GET" });
      promise.catch(() => undefined); // prevent unhandled-rejection during fake-timer advance
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toBeInstanceOf(DatabricksError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("falls back to OAuth M2M when only client_id + client_secret are set", async () => {
      delete process.env.DATABRICKS_TOKEN;
      process.env.DATABRICKS_CLIENT_ID = "sp-client-id";
      process.env.DATABRICKS_CLIENT_SECRET = "sp-client-secret";

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: "oauth-token-xyz", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const { dbxFetch } = await import("../../lib/services/databricks/client.js");
      await dbxFetch("/api/2.0/thing", { method: "GET" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [oauthUrl, oauthInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(oauthUrl).toBe(`${HOST}/oidc/v1/token`);
      expect(oauthInit.method).toBe("POST");
      const oauthHeaders = new Headers(oauthInit.headers);
      expect(oauthHeaders.get("Authorization")).toMatch(/^Basic /);
      expect(oauthInit.body).toBe("grant_type=client_credentials&scope=all-apis");

      const [apiUrl, apiInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(apiUrl).toBe(`${HOST}/api/2.0/thing`);
      const apiHeaders = new Headers(apiInit.headers);
      expect(apiHeaders.get("Authorization")).toBe("Bearer oauth-token-xyz");

      delete process.env.DATABRICKS_CLIENT_ID;
      delete process.env.DATABRICKS_CLIENT_SECRET;
    });

    it("throws DatabricksError immediately on 4xx (non-429)", async () => {
      fetchMock.mockResolvedValueOnce(textResponse("bad request", 400));

      const { dbxFetch, DatabricksError } = await import("../../lib/services/databricks/client.js");

      await expect(dbxFetch("/api/2.0/bad")).rejects.toBeInstanceOf(DatabricksError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

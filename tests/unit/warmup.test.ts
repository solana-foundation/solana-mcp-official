import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchDocsMock } = vi.hoisted(() => ({
  searchDocsMock: vi.fn(),
}));

vi.mock("../../lib/services/databricks/vectorSearch.js", () => ({
  searchDocs: searchDocsMock,
}));

import { warmup } from "../../lib";

describe("warmup", () => {
  beforeEach(() => {
    searchDocsMock.mockReset();
  });

  afterEach(() => {
    searchDocsMock.mockReset();
  });

  it("primes the vector search endpoint with a single low-k query", async () => {
    searchDocsMock.mockResolvedValue([]);
    await warmup();
    expect(searchDocsMock).toHaveBeenCalledTimes(1);
    expect(searchDocsMock).toHaveBeenCalledWith("solana", 1);
  });

  it("swallows errors so a deploy never fails on a transient RAG outage", async () => {
    searchDocsMock.mockRejectedValue(new Error("vector index unavailable"));
    await expect(warmup()).resolves.toBeUndefined();
  });
});

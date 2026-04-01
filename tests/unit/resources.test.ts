import { beforeEach, describe, expect, it, vi } from "vitest";
import { resources } from "../../lib/resources";

describe("resources", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns clusters content when source fetch succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue("clusters-mdx-content"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const clustersResource = resources.find(resource => resource.name === "solanaDocsClusters");
    expect(clustersResource).toBeDefined();
    if (!clustersResource) return;

    const uri = new URL("solana://clusters");
    const result = await clustersResource.func(uri);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/solana-foundation/solana-com/main/content/docs/references/clusters.mdx",
    );
    expect(result).toEqual({
      contents: [{ uri: "solana://clusters", text: "clusters-mdx-content" }],
    });
  });

  it("returns a structured error payload when source fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const installationResource = resources.find(resource => resource.name === "solanaDocsInstallation");
    expect(installationResource).toBeDefined();
    if (!installationResource) return;

    const uri = new URL("solana://installation");
    const result = await installationResource.func(uri);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/solana-foundation/solana-com/main/content/docs/intro/installation.mdx",
    );
    expect(result).toEqual({
      contents: [{ uri: "solana://installation", text: "Error: network down" }],
    });
  });
});

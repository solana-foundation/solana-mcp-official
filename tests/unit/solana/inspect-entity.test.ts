import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { SourceUnavailableError } from "../../../lib/solana/rpc";
import { handleInspectEntity } from "../../../lib/solana/inspect-entity";

const ACCOUNT_IDENTIFIER = "11111111111111111111111111111111";
const TRANSACTION_IDENTIFIER =
  "4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9";

type InspectEntityDeps = Parameters<typeof handleInspectEntity>[1];

function createDependencies(overrides: Partial<InspectEntityDeps> = {}): InspectEntityDeps {
  return {
    fetchAccountInfo: vi.fn().mockResolvedValue({ value: null }),
    fetchTransaction: vi.fn().mockResolvedValue(null),
    fetchAsset: vi.fn().mockResolvedValue(null),
    resolveProgramVerification: vi.fn().mockResolvedValue({ status: "unknown", reason: "source_unavailable" }),
    resolveProgramSecurityMetadata: vi.fn().mockResolvedValue({ status: "unknown", reason: "source_unavailable" }),
    resolveMultisigReference: vi.fn().mockResolvedValue({ status: "not_multisig" }),
    resolveProgramIdl: vi.fn().mockResolvedValue({ status: "not_found" }),
    fetchSignatureStatus: vi.fn().mockResolvedValue({ value: null }),
    ...overrides,
  };
}

function parseEnvelope(result: CallToolResult): Record<string, unknown> {
  const contentItem = result.content[0];
  if (!contentItem || contentItem.type !== "text") {
    throw new Error("Expected text content envelope.");
  }
  const parsed = JSON.parse(contentItem.text) as Record<string, unknown>;
  expect(parsed).toEqual(result.structuredContent);
  return parsed;
}

describe("inspect_entity handler", () => {
  it("returns INVALID_ARGUMENT for malformed or oversized input", async () => {
    const resultMalformed = await handleInspectEntity({});
    const malformedEnvelope = parseEnvelope(resultMalformed);

    expect(resultMalformed.isError).toBe(true);
    expect(malformedEnvelope).toMatchObject({
      errors: [{ code: "INVALID_ARGUMENT", message: expect.stringContaining("identifier") }],
    });

    const resultOversized = await handleInspectEntity({ identifier: "1".repeat(129) });
    const oversizedEnvelope = parseEnvelope(resultOversized);
    expect(oversizedEnvelope).toMatchObject({
      errors: [{ code: "INVALID_ARGUMENT" }],
    });
  });

  it("rejects identifiers that do not decode to 32 or 64 bytes", async () => {
    const result = await handleInspectEntity({ identifier: "abc" });
    const envelope = parseEnvelope(result);

    expect(envelope).toMatchObject({
      errors: [{ code: "INVALID_ARGUMENT", message: "identifier must decode from base58 to 32 or 64 bytes" }],
    });
  });

  it("returns NOT_FOUND for account probes with explicit null", async () => {
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockResolvedValue({ value: null }),
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(envelope).toMatchObject({
      payload: { entity: { kind: "account" } },
      errors: [{ code: "NOT_FOUND" }],
    });
  });

  it("maps account timeout failures to INTERNAL_ERROR with fixed source marker", async () => {
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockRejectedValue(new SourceUnavailableError("RPC request timed out.")),
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(envelope).toMatchObject({
      payload: {
        entity: {
          kind: "account",
          source: { value: null, status: "unknown", reason: "source_unavailable" },
        },
      },
      errors: [{ code: "INTERNAL_ERROR" }],
    });
  });

  it("maps generic fetchAccountInfo errors to INTERNAL_ERROR without source marker", async () => {
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockRejectedValue(new Error("unexpected")),
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(result.isError).toBe(true);
    expect(envelope).toMatchObject({
      payload: {},
      errors: [{ code: "INTERNAL_ERROR" }],
    });
  });

  it("skips DAS lookup when base account kind is already known", async () => {
    const fetchAsset = vi.fn();
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockResolvedValue({
        value: {
          owner: "Stake11111111111111111111111111111111111111",
          lamports: 0,
          executable: false,
          data: { program: "stake", parsed: {} },
        },
      }),
      fetchAsset,
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);

    expect(result.isError).toBe(false);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("issues a second RPC probe for upgradeable programData", async () => {
    const executableDataAddress = "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY";
    const fetchAccountInfo = vi
      .fn()
      .mockResolvedValueOnce({
        value: {
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          lamports: 567591537,
          executable: true,
          data: {
            program: "bpf-upgradeable-loader",
            parsed: { type: "program", info: { programData: executableDataAddress } },
          },
        },
      })
      .mockResolvedValueOnce({
        value: {
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          lamports: 0,
          executable: false,
          data: {
            program: "bpf-upgradeable-loader",
            parsed: {
              type: "programData",
              info: {
                authority: "AeLnXCBPaQHGWRLr2saFsEVfnMNuKixRAbWCT9P5twgZ",
                data: [Buffer.from("00", "hex").toString("base64"), "base64"],
                slot: 395847597,
              },
            },
          },
        },
      });
    const dependencies = createDependencies({ fetchAccountInfo });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(result.isError).toBe(false);
    expect(fetchAccountInfo).toHaveBeenCalledTimes(2);
    expect(envelope).toMatchObject({
      payload: { entity: { kind: "bpf-upgradeable-loader" } },
      errors: [],
    });
  });

  it("stays successful when second programData probe is unavailable", async () => {
    const fetchAccountInfo = vi
      .fn()
      .mockResolvedValueOnce({
        value: {
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          lamports: 567591537,
          executable: true,
          data: {
            program: "bpf-upgradeable-loader",
            parsed: { type: "program", info: { programData: "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY" } },
          },
        },
      })
      .mockRejectedValueOnce(new SourceUnavailableError("probe timeout"));
    const dependencies = createDependencies({ fetchAccountInfo });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);

    expect(result.isError).toBe(false);
    const envelope = parseEnvelope(result);
    expect(envelope).toMatchObject({
      payload: { entity: { kind: "bpf-upgradeable-loader" } },
      errors: [],
    });
  });

  it("treats malformed second programData payload as non-error", async () => {
    const fetchAccountInfo = vi
      .fn()
      .mockResolvedValueOnce({
        value: {
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          lamports: 567591537,
          executable: true,
          data: {
            program: "bpf-upgradeable-loader",
            parsed: { type: "program", info: { programData: "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY" } },
          },
        },
      })
      .mockResolvedValueOnce({
        value: {
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          lamports: 0,
          executable: false,
          data: { program: "other", parsed: null },
        },
      });
    const dependencies = createDependencies({ fetchAccountInfo });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);

    expect(result.isError).toBe(false);
    const envelope = parseEnvelope(result);
    expect(envelope).toMatchObject({
      payload: { entity: { kind: "bpf-upgradeable-loader" } },
      errors: [],
    });
  });

  it("promotes unknown account to compressed-nft via DAS", async () => {
    const fetchAsset = vi.fn().mockResolvedValue({
      id: "asset-id",
      compression: { compressed: true, tree: "tree-id" },
      ownership: { owner: "owner-id" },
    });
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockResolvedValue({
        value: {
          owner: "UnknownOwner",
          lamports: 0,
          executable: false,
          data: { program: "unknown-program", parsed: { type: "other" } },
        },
      }),
      fetchAsset,
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(result.isError).toBe(false);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(envelope).toMatchObject({
      payload: { entity: { kind: "compressed-nft" } },
      errors: [],
    });
  });

  it("falls back to unknown kind when DAS lookup fails", async () => {
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockResolvedValue({
        value: {
          owner: "UnknownOwner",
          lamports: 0,
          executable: false,
          data: { program: "unknown-program", parsed: { type: "other" } },
        },
      }),
      fetchAsset: vi.fn().mockRejectedValue(new Error("das unavailable")),
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(result.isError).toBe(false);
    expect(envelope).toMatchObject({
      payload: { entity: { kind: "unknown" } },
      errors: [],
    });
  });

  it("classifies ALT from raw bytes without DAS lookup", async () => {
    const fetchAsset = vi.fn();
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockResolvedValue({
        value: {
          owner: "AddressLookupTab1e1111111111111111111111111",
          lamports: 0,
          executable: false,
          data: [Buffer.from(new Uint8Array(56)).toString("base64"), "base64"],
        },
      }),
      fetchAsset,
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);

    expect(result.isError).toBe(false);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("returns CURRENTLY_UNSUPPORTED for transaction identifiers", async () => {
    const result = await handleInspectEntity({ identifier: TRANSACTION_IDENTIFIER });
    const envelope = parseEnvelope(result);

    expect(result.isError).toBe(true);
    expect(envelope).toMatchObject({
      errors: [{ code: "CURRENTLY_UNSUPPORTED" }],
    });
  });

  it("returns INTERNAL_ERROR when account probe payload is malformed", async () => {
    const dependencies = createDependencies({
      fetchAccountInfo: vi.fn().mockResolvedValue({ value: undefined }),
    });

    const result = await handleInspectEntity({ identifier: ACCOUNT_IDENTIFIER }, dependencies);
    const envelope = parseEnvelope(result);

    expect(envelope).toMatchObject({
      payload: {},
      errors: [{ code: "INTERNAL_ERROR" }],
    });
  });
});

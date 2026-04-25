import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/solana/resolvers/pmp-idl", () => ({
  fetchPmpIdlMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../../lib/solana/anchor", () => ({
  createReadOnlyProvider: vi.fn().mockReturnValue({}),
  fetchAnchorIdl: vi.fn().mockResolvedValue(null),
}));

import { fetchPmpIdlMetadata } from "../../../../lib/solana/resolvers/pmp-idl";
import { fetchAnchorIdl } from "../../../../lib/solana/anchor";
import { resolveProgramIdl } from "../../../../lib/solana/resolvers/idl";

const PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const CLUSTER = "mainnet-beta" as const;

function makeAnchorIdlJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    address: PROGRAM_ADDRESS,
    metadata: { name: "test_program", version: "0.1.0", spec: "0.1.0" },
    instructions: [
      {
        name: "initialize",
        discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
        accounts: [],
        args: [],
      },
    ],
    accounts: [],
    types: [],
    errors: [],
    events: [],
    constants: [],
    ...overrides,
  });
}

function makeAnchorIdlObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: PROGRAM_ADDRESS,
    metadata: { name: "test_program", version: "0.1.0", spec: "0.1.0" },
    instructions: [
      {
        name: "initialize",
        discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
        accounts: [],
        args: [],
      },
    ],
    accounts: [],
    types: [],
    errors: [],
    events: [],
    constants: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(null);
  vi.mocked(fetchAnchorIdl).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveProgramIdl", () => {
  it("returns found from PMP when canonical IDL exists", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(makeAnchorIdlJson());

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toMatchObject({
      status: "found",
      source_type: "pmp_canonical",
      idl_type: "anchor",
      program_name: "test_program",
    });
    expect(fetchPmpIdlMetadata).toHaveBeenCalled();
    expect(fetchAnchorIdl).toHaveBeenCalled();
  });

  it("falls through to Anchor when PMP returns null", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(null);
    vi.mocked(fetchAnchorIdl).mockResolvedValue(makeAnchorIdlObject() as never);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toMatchObject({
      status: "found",
      source_type: "anchor_on_chain",
      idl_type: "anchor",
      program_name: "test_program",
    });
  });

  it("returns not_found when both sources return null", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(null);
    vi.mocked(fetchAnchorIdl).mockResolvedValue(null);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({ status: "not_found" });
  });

  it("falls through to Anchor when PMP throws", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockRejectedValue(new Error("network error"));
    vi.mocked(fetchAnchorIdl).mockResolvedValue(makeAnchorIdlObject() as never);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toMatchObject({
      status: "found",
      source_type: "anchor_on_chain",
    });
  });

  it("returns unknown when PMP throws and Anchor has no IDL", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockRejectedValue(new Error("network error"));
    vi.mocked(fetchAnchorIdl).mockResolvedValue(null);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("returns unknown with idl_invalid when PMP returns non-JSON", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue("not valid json {{");
    vi.mocked(fetchAnchorIdl).mockResolvedValue(null);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "idl_invalid",
    });
  });

  it("returns unknown with idl_invalid when Anchor returns unrecognizable IDL", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(null);
    vi.mocked(fetchAnchorIdl).mockResolvedValue({
      random: "garbage",
    } as never);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "idl_invalid",
    });
  });

  it("returns unknown when both sources throw", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockRejectedValue(new Error("pmp error"));
    vi.mocked(fetchAnchorIdl).mockRejectedValue(new Error("anchor error"));

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("rejects PMP IDL with mismatching address and falls through to Anchor", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(
      makeAnchorIdlJson({
        address: "DifferentProg1111111111111111111111111111111",
      }),
    );
    vi.mocked(fetchAnchorIdl).mockResolvedValue(makeAnchorIdlObject() as never);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toMatchObject({
      status: "found",
      source_type: "anchor_on_chain",
    });
  });

  it("rejects Anchor IDL with mismatching address", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(null);
    vi.mocked(fetchAnchorIdl).mockResolvedValue(
      makeAnchorIdlObject({
        address: "WrongAddr111111111111111111111111111111111",
      }) as never,
    );

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "idl_invalid",
    });
  });

  it("returns unknown when both IDLs have mismatching addresses", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(
      makeAnchorIdlJson({
        address: "BadAddr1111111111111111111111111111111111111",
      }),
    );
    vi.mocked(fetchAnchorIdl).mockResolvedValue(
      makeAnchorIdlObject({
        address: "BadAddr2222222222222222222222222222222222222",
      }) as never,
    );

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "idl_invalid",
    });
  });

  it("rejects PMP IDL with no address and falls through to Anchor", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(makeAnchorIdlJson({ address: undefined }));
    vi.mocked(fetchAnchorIdl).mockResolvedValue(makeAnchorIdlObject() as never);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toMatchObject({
      status: "found",
      source_type: "anchor_on_chain",
    });
  });

  it("returns unknown with address_unverified when neither IDL has an address", async () => {
    vi.mocked(fetchPmpIdlMetadata).mockResolvedValue(makeAnchorIdlJson({ address: undefined }));
    vi.mocked(fetchAnchorIdl).mockResolvedValue(makeAnchorIdlObject({ address: undefined }) as never);

    const result = await resolveProgramIdl(PROGRAM_ADDRESS, CLUSTER);

    expect(result).toEqual({
      status: "unknown",
      reason: "address_unverified",
    });
  });
});

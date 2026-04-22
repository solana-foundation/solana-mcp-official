import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../lib/solana/anchor", () => ({
  createReadOnlyProvider: vi.fn().mockReturnValue({}),
  createAnchorProgram: vi.fn().mockResolvedValue(null),
}));

import { resolveMultisigReference } from "../../../../lib/solana/resolvers/squads-multisig";
import { createAnchorProgram } from "../../../../lib/solana/anchor";

const AUTHORITY = "AeLnXCBPaQHGWRLr2saFsEVfnMNuKixRAbWCT9P5twgZ";
const MULTISIG_ADDR = "MSIG1111111111111111111111111111111111111111";
const MAINNET = "mainnet-beta" as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockProgram(accountName: string, fetchResult: unknown) {
  return {
    account: {
      [accountName]: {
        fetch: vi.fn().mockResolvedValue(fetchResult),
      },
    },
  };
}

function makeLambdaResponse(data: { isSquad: boolean; version: string; multisig: string } | { error: Error }) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  vi.mocked(createAnchorProgram).mockResolvedValue(null as never);
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ── Guard clauses ────────────────────────────────────────────────────────────

describe("resolveMultisigReference — guard clauses", () => {
  it("returns not_multisig for null authority", async () => {
    const result = await resolveMultisigReference(null, MAINNET);
    expect(result).toEqual({ status: "not_multisig" });
  });

  it("returns unknown for non-mainnet cluster", async () => {
    const result = await resolveMultisigReference(AUTHORITY, "devnet");
    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });
});

// ── Lambda detection ─────────────────────────────────────────────────────────

describe("resolveMultisigReference — Lambda detection", () => {
  it("returns not_multisig when Lambda says not squad", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeLambdaResponse({ isSquad: false, version: "v4", multisig: "" }));
    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "not_multisig" });
  });

  it("returns not_multisig when Lambda returns error", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeLambdaResponse({ error: new Error("not found") }));
    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "not_multisig" });
  });

  it("returns unknown when Lambda network fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "unknown", reason: "source_unavailable" });
  });

  it("returns unknown when Lambda returns HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn(),
    } as unknown as Response);
    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "unknown", reason: "source_unavailable" });
  });

  it("returns unknown when Lambda returns malformed JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    } as unknown as Response);
    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "unknown", reason: "source_unavailable" });
  });

  it("returns not_multisig when Lambda returns unrecognized version", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v5",
        multisig: AUTHORITY,
      }),
    );
    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "not_multisig" });
  });
});

// ── V3 Anchor.fetch ──────────────────────────────────────────────────────────

describe("resolveMultisigReference — V3 Anchor.fetch", () => {
  it("returns full V3 details when Lambda + Anchor.fetch succeed", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v3",
        multisig: AUTHORITY,
      }),
    );
    const mockProgram = makeMockProgram("ms", {
      threshold: 2,
      keys: [
        { toString: () => "Pubkey1111111111111111111111111111111111111" },
        { toString: () => "Pubkey2222222222222222222222222222222222222" },
        { toString: () => "Pubkey3333333333333333333333333333333333333" },
      ],
    });
    vi.mocked(createAnchorProgram).mockResolvedValue(mockProgram as never);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "is_multisig",
      version: "v3",
      multisig_address: AUTHORITY,
      threshold: 2,
      members: [
        "Pubkey1111111111111111111111111111111111111",
        "Pubkey2222222222222222222222222222222222222",
        "Pubkey3333333333333333333333333333333333333",
      ],
    });
  });

  it("returns unknown when Anchor.fetch throws", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v3",
        multisig: AUTHORITY,
      }),
    );
    const mockProgram = makeMockProgram("ms", null);
    (mockProgram.account["ms"]!.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("decode error"));
    vi.mocked(createAnchorProgram).mockResolvedValue(mockProgram as never);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("returns null details when V3 account returns null", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v3",
        multisig: AUTHORITY,
      }),
    );
    const mockProgram = makeMockProgram("ms", null);
    vi.mocked(createAnchorProgram).mockResolvedValue(mockProgram as never);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "is_multisig",
      version: "v3",
      multisig_address: AUTHORITY,
      threshold: null,
      members: null,
    });
  });

  it("returns null details when V3 threshold is invalid", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v3",
        multisig: AUTHORITY,
      }),
    );
    const mockProgram = makeMockProgram("ms", {
      threshold: 0,
      keys: [{ toString: () => "Pubkey1111111111111111111111111111111111111" }],
    });
    vi.mocked(createAnchorProgram).mockResolvedValue(mockProgram as never);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "is_multisig",
      version: "v3",
      multisig_address: AUTHORITY,
      threshold: null,
      members: null,
    });
  });
});

// ── V4 Anchor.fetch ──────────────────────────────────────────────────────────

describe("resolveMultisigReference — V4 Anchor.fetch", () => {
  it("returns full V4 details when Lambda + Anchor.fetch succeed", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v4",
        multisig: MULTISIG_ADDR,
      }),
    );
    const mockProgram = makeMockProgram("multisig", {
      threshold: 3,
      members: [
        {
          key: {
            toString: () => "Mem111111111111111111111111111111111111111",
          },
        },
        {
          key: {
            toString: () => "Mem222222222222222222222222222222222222222",
          },
        },
        {
          key: {
            toString: () => "Mem333333333333333333333333333333333333333",
          },
        },
      ],
    });
    vi.mocked(createAnchorProgram).mockResolvedValue(mockProgram as never);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "is_multisig",
      version: "v4",
      multisig_address: MULTISIG_ADDR,
      threshold: 3,
      members: [
        "Mem111111111111111111111111111111111111111",
        "Mem222222222222222222222222222222222222222",
        "Mem333333333333333333333333333333333333333",
      ],
    });
  });

  it("returns unknown when V4 Anchor.fetch throws", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v4",
        multisig: MULTISIG_ADDR,
      }),
    );
    const mockProgram = makeMockProgram("multisig", null);
    (mockProgram.account["multisig"]!.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("decode error"));
    vi.mocked(createAnchorProgram).mockResolvedValue(mockProgram as never);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });
});

// ── Unexpected errors ────────────────────────────────────────────────────────

describe("resolveMultisigReference — error resilience", () => {
  it("returns unknown when createAnchorProgram throws unexpectedly", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeLambdaResponse({
        isSquad: true,
        version: "v3",
        multisig: AUTHORITY,
      }),
    );
    vi.mocked(createAnchorProgram).mockRejectedValue(new Error("unexpected"));

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });
});

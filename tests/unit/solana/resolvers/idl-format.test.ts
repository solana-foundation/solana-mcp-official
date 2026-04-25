import { describe, expect, it } from "vitest";

import { detectIdlFormat, validateIdlProgramAddress } from "../../../../lib/solana/resolvers/idl-format";

const PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("detectIdlFormat", () => {
  it("detects modern Anchor IDL", () => {
    const idl = {
      address: PROGRAM_ADDRESS,
      metadata: { name: "token", version: "0.1.0", spec: "0.1.0" },
      instructions: [],
    };
    expect(detectIdlFormat(idl)).toEqual({
      idl_type: "anchor",
      program_name: "token",
    });
  });

  it("detects legacy Anchor IDL", () => {
    const idl = {
      version: "0.9.4",
      name: "my_program",
      instructions: [],
      types: [],
    };
    expect(detectIdlFormat(idl)).toEqual({
      idl_type: "anchor_legacy",
      program_name: "my_program",
    });
  });

  it("detects Shank IDL via metadata.origin", () => {
    const idl = {
      name: "shank_program",
      instructions: [],
      metadata: { origin: "shank", address: PROGRAM_ADDRESS },
    };
    expect(detectIdlFormat(idl)).toEqual({
      idl_type: "shank",
      program_name: "shank_program",
    });
  });

  it("detects Codama IDL", () => {
    const idl = {
      standard: "codama",
      version: "1.0.0",
      program: {
        name: "codama_program",
        publicKey: PROGRAM_ADDRESS,
        instructions: [],
      },
    };
    expect(detectIdlFormat(idl)).toEqual({
      idl_type: "codama",
      program_name: "codama_program",
    });
  });

  it("returns null for unrecognizable format", () => {
    expect(detectIdlFormat({ random: "data" })).toBeNull();
    expect(detectIdlFormat({})).toBeNull();
  });

  it("returns null program_name when name field is missing", () => {
    const idl = { metadata: { spec: "0.1.0" }, instructions: [] };
    expect(detectIdlFormat(idl)).toEqual({
      idl_type: "anchor",
      program_name: null,
    });
  });

  it("prefers codama over anchor when both standard and metadata.spec present", () => {
    const idl = {
      standard: "codama",
      metadata: { spec: "0.1.0" },
      program: { name: "codama_wins" },
    };
    expect(detectIdlFormat(idl)?.idl_type).toBe("codama");
  });
});

describe("validateIdlProgramAddress", () => {
  it("returns valid when modern Anchor address matches", () => {
    const idl = { address: PROGRAM_ADDRESS };
    expect(validateIdlProgramAddress(idl, "anchor", PROGRAM_ADDRESS)).toBe("valid");
  });

  it("returns mismatch when modern Anchor address differs", () => {
    const idl = { address: "DifferentProgram1111111111111111111111111111" };
    expect(validateIdlProgramAddress(idl, "anchor", PROGRAM_ADDRESS)).toBe("mismatch");
  });

  it("returns valid when legacy/shank metadata address matches", () => {
    const idl = { metadata: { address: PROGRAM_ADDRESS } };
    expect(validateIdlProgramAddress(idl, "anchor_legacy", PROGRAM_ADDRESS)).toBe("valid");
    expect(validateIdlProgramAddress(idl, "shank", PROGRAM_ADDRESS)).toBe("valid");
  });

  it("returns mismatch when legacy metadata address differs", () => {
    const idl = {
      metadata: { address: "WrongAddr1111111111111111111111111111111111" },
    };
    expect(validateIdlProgramAddress(idl, "anchor_legacy", PROGRAM_ADDRESS)).toBe("mismatch");
  });

  it("returns valid when Codama program publicKey matches", () => {
    const idl = { program: { publicKey: PROGRAM_ADDRESS } };
    expect(validateIdlProgramAddress(idl, "codama", PROGRAM_ADDRESS)).toBe("valid");
  });

  it("returns mismatch when Codama program publicKey differs", () => {
    const idl = {
      program: {
        publicKey: "BadKey11111111111111111111111111111111111111",
      },
    };
    expect(validateIdlProgramAddress(idl, "codama", PROGRAM_ADDRESS)).toBe("mismatch");
  });

  it("returns unverified when IDL has no address field", () => {
    expect(validateIdlProgramAddress({}, "anchor", PROGRAM_ADDRESS)).toBe("unverified");
    expect(validateIdlProgramAddress({}, "anchor_legacy", PROGRAM_ADDRESS)).toBe("unverified");
    expect(validateIdlProgramAddress({}, "codama", PROGRAM_ADDRESS)).toBe("unverified");
  });
});

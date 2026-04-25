import type { IdlType } from "../types";
import { asRecord } from "../parse-helpers";

type IdlFormatResult = {
  idl_type: IdlType;
  program_name: string | null;
};

export function detectIdlFormat(idl: Record<string, unknown>): IdlFormatResult | null {
  // Priority 1: Codama (standard === "codama")
  if (idl.standard === "codama") {
    const program = asRecord(idl.program);
    return {
      idl_type: "codama",
      program_name: typeof program?.name === "string" ? program.name : null,
    };
  }

  const metadata = asRecord(idl.metadata);

  // Priority 2: Modern Anchor (metadata.spec exists)
  if (typeof metadata?.spec === "string") {
    return {
      idl_type: "anchor",
      program_name: typeof metadata.name === "string" ? metadata.name : null,
    };
  }

  // Priority 3: Shank (metadata.origin === "shank")
  if (metadata?.origin === "shank") {
    return {
      idl_type: "shank",
      program_name: typeof idl.name === "string" ? (idl.name as string) : null,
    };
  }

  // Priority 4: Legacy Anchor (has name + instructions array)
  if (typeof idl.name === "string" && Array.isArray(idl.instructions)) {
    return {
      idl_type: "anchor_legacy",
      program_name: idl.name as string,
    };
  }

  // No match
  return null;
}

export type AddressValidationResult = "valid" | "mismatch" | "unverified";

export function validateIdlProgramAddress(
  idl: Record<string, unknown>,
  idlType: IdlType,
  expectedProgramAddress: string,
): AddressValidationResult {
  let idlAddress: string | null = null;

  if (idlType === "anchor") {
    idlAddress = typeof idl.address === "string" ? (idl.address as string) : null;
  } else if (idlType === "anchor_legacy" || idlType === "shank") {
    const metadata = asRecord(idl.metadata);
    idlAddress = typeof metadata?.address === "string" ? (metadata.address as string) : null;
  } else if (idlType === "codama") {
    const program = asRecord(idl.program);
    idlAddress = typeof program?.publicKey === "string" ? (program.publicKey as string) : null;
  }

  // No address in IDL → cannot verify, mark as unverified.
  if (idlAddress === null) return "unverified";

  return idlAddress === expectedProgramAddress ? "valid" : "mismatch";
}

import { describe, expect, it } from "vitest";

import {
  resolveStaticAccounts,
  resolveV0Accounts,
  selectAccountResolver,
} from "../../../../lib/solana/transaction/account-resolver";

describe("resolveStaticAccounts", () => {
  it("classifies single signer with no readonly", () => {
    const result = resolveStaticAccounts({
      staticKeys: ["fee-payer", "other"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    });

    expect(result.accountKeys).toEqual(["fee-payer", "other"]);
    expect(result.resolvedAccounts).toEqual([
      { address: "fee-payer", signer: true, writable: true },
      { address: "other", signer: false, writable: true },
    ]);
  });

  it("classifies mixed signers with readonly signed and unsigned", () => {
    const result = resolveStaticAccounts({
      staticKeys: ["fee-payer", "readonly-signer", "writable-nonsigner", "program"],
      header: { numRequiredSignatures: 2, numReadonlySignedAccounts: 1, numReadonlyUnsignedAccounts: 1 },
    });

    expect(result.resolvedAccounts).toEqual([
      { address: "fee-payer", signer: true, writable: true },
      { address: "readonly-signer", signer: true, writable: false },
      { address: "writable-nonsigner", signer: false, writable: true },
      { address: "program", signer: false, writable: false },
    ]);
  });

  it("classifies multiple readonly signers", () => {
    const result = resolveStaticAccounts({
      staticKeys: ["fee-payer", "cosigner-ro-1", "cosigner-ro-2", "other"],
      header: { numRequiredSignatures: 3, numReadonlySignedAccounts: 2, numReadonlyUnsignedAccounts: 0 },
    });

    expect(result.resolvedAccounts).toEqual([
      { address: "fee-payer", signer: true, writable: true },
      { address: "cosigner-ro-1", signer: true, writable: false },
      { address: "cosigner-ro-2", signer: true, writable: false },
      { address: "other", signer: false, writable: true },
    ]);
  });

  it("marks all accounts writable when both readonly counts are zero", () => {
    const result = resolveStaticAccounts({
      staticKeys: ["signer-a", "signer-b", "other"],
      header: { numRequiredSignatures: 2, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    });

    expect(result.resolvedAccounts).toEqual([
      { address: "signer-a", signer: true, writable: true },
      { address: "signer-b", signer: true, writable: true },
      { address: "other", signer: false, writable: true },
    ]);
  });

  it("returns accountKeys identical to staticKeys input", () => {
    const staticKeys = ["a", "b", "c"];
    const result = resolveStaticAccounts({
      staticKeys,
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    });

    expect(result.accountKeys).toEqual(staticKeys);
  });

  it("ignores loadedAddresses when provided", () => {
    const result = resolveStaticAccounts({
      staticKeys: ["signer", "program"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      loadedAddresses: { writable: ["alt-w1"], readonly: ["alt-r1"] },
    });

    expect(result.accountKeys).toEqual(["signer", "program"]);
    expect(result.resolvedAccounts).toHaveLength(2);
  });
});

describe("resolveV0Accounts", () => {
  it("merges static keys with loaded writable and readonly", () => {
    const result = resolveV0Accounts({
      staticKeys: ["signer", "program", "readonly"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      loadedAddresses: { writable: ["alt-w1", "alt-w2"], readonly: ["alt-r1"] },
    });

    expect(result.accountKeys).toEqual(["signer", "program", "readonly", "alt-w1", "alt-w2", "alt-r1"]);
    expect(result.resolvedAccounts).toEqual([
      { address: "signer", signer: true, writable: true },
      { address: "program", signer: false, writable: true },
      { address: "readonly", signer: false, writable: false },
      { address: "alt-w1", signer: false, writable: true },
      { address: "alt-w2", signer: false, writable: true },
      { address: "alt-r1", signer: false, writable: false },
    ]);
  });

  it("behaves like static resolver when loadedAddresses is null", () => {
    const result = resolveV0Accounts({
      staticKeys: ["signer", "program"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      loadedAddresses: null,
    });

    expect(result.accountKeys).toEqual(["signer", "program"]);
    expect(result.resolvedAccounts).toEqual([
      { address: "signer", signer: true, writable: true },
      { address: "program", signer: false, writable: false },
    ]);
  });

  it("behaves like static resolver when loadedAddresses arrays are empty", () => {
    const result = resolveV0Accounts({
      staticKeys: ["signer", "program"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      loadedAddresses: { writable: [], readonly: [] },
    });

    expect(result.accountKeys).toEqual(["signer", "program"]);
    expect(result.resolvedAccounts).toHaveLength(2);
  });

  it("appends only loaded writable when no loaded readonly", () => {
    const result = resolveV0Accounts({
      staticKeys: ["signer"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
      loadedAddresses: { writable: ["alt-w1"], readonly: [] },
    });

    expect(result.accountKeys).toEqual(["signer", "alt-w1"]);
    expect(result.resolvedAccounts[1]).toEqual({ address: "alt-w1", signer: false, writable: true });
  });

  it("appends only loaded readonly when no loaded writable", () => {
    const result = resolveV0Accounts({
      staticKeys: ["signer"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
      loadedAddresses: { writable: [], readonly: ["alt-r1"] },
    });

    expect(result.accountKeys).toEqual(["signer", "alt-r1"]);
    expect(result.resolvedAccounts[1]).toEqual({ address: "alt-r1", signer: false, writable: false });
  });
});

describe("selectAccountResolver", () => {
  it("returns resolveStaticAccounts for legacy", () => {
    expect(selectAccountResolver("legacy")).toBe(resolveStaticAccounts);
  });

  it("returns resolveStaticAccounts for null", () => {
    expect(selectAccountResolver(null)).toBe(resolveStaticAccounts);
  });

  it("returns resolveStaticAccounts for version 1", () => {
    expect(selectAccountResolver(1)).toBe(resolveStaticAccounts);
  });

  it("returns resolveV0Accounts for version 0", () => {
    expect(selectAccountResolver(0)).toBe(resolveV0Accounts);
  });

  it("v0 resolver produces different output than static when loadedAddresses present", () => {
    const params = {
      staticKeys: ["signer"],
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
      loadedAddresses: { writable: ["alt-w1"], readonly: [] },
    };

    const v0Result = selectAccountResolver(0)(params);
    const legacyResult = selectAccountResolver("legacy")(params);

    expect(v0Result.accountKeys).toHaveLength(2);
    expect(legacyResult.accountKeys).toHaveLength(1);
  });
});

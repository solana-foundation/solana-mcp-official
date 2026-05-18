import { describe, expect, it } from "vitest";
import { runRustAutofixer } from "../../../lib/tools/rustAutofixer/handler.js";
import {
  VULNERABLE_SEEDS_WITHOUT_BUMP,
  SECURE_SEEDS_WITH_BUMP,
  VULNERABLE_INIT_WITHOUT_SPACE,
  SECURE_INIT_WITH_SPACE,
  VULNERABLE_INIT_WITHOUT_PAYER,
  SECURE_INIT_WITH_PAYER,
  VULNERABLE_REALLOC_INCOMPLETE,
  SECURE_REALLOC_COMPLETE,
  VULNERABLE_UNCHECKED_ACCOUNT,
  SECURE_TYPED_ACCOUNT,
} from "./fixtures-anchor.js";

const PAIRS: ReadonlyArray<{
  rule: string;
  vulnerable: string;
  secure: string;
}> = [
  { rule: "anchor-seeds-without-bump", vulnerable: VULNERABLE_SEEDS_WITHOUT_BUMP, secure: SECURE_SEEDS_WITH_BUMP },
  { rule: "anchor-init-without-space", vulnerable: VULNERABLE_INIT_WITHOUT_SPACE, secure: SECURE_INIT_WITH_SPACE },
  { rule: "anchor-init-without-payer", vulnerable: VULNERABLE_INIT_WITHOUT_PAYER, secure: SECURE_INIT_WITH_PAYER },
  { rule: "anchor-realloc-incomplete", vulnerable: VULNERABLE_REALLOC_INCOMPLETE, secure: SECURE_REALLOC_COMPLETE },
  { rule: "anchor-unchecked-account", vulnerable: VULNERABLE_UNCHECKED_ACCOUNT, secure: SECURE_TYPED_ACCOUNT },
];

describe("rust_autofixer Anchor tier-1 visitors", () => {
  it.each(PAIRS)(
    "$rule fires on vulnerable Anchor fixture",
    async ({ rule, vulnerable }) => {
      const out = await runRustAutofixer({ code: vulnerable, framework: "anchor" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `expected ${rule} to fire; got: ${JSON.stringify(out.issues.map(i => i.rule))}`).toBeDefined();
    },
    20_000,
  );

  it.each(PAIRS)(
    "$rule silent on secure Anchor fixture",
    async ({ rule, secure }) => {
      const out = await runRustAutofixer({ code: secure, framework: "anchor" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} fired on secure fixture: ${hit?.title}`).toBeUndefined();
    },
    20_000,
  );

  it("auto-detects Anchor and runs tier-1 visitors", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_INIT_WITHOUT_PAYER, framework: "auto" });
    const hit = out.issues.find(i => i.rule === "anchor-init-without-payer");
    expect(hit, "auto-detect failed to identify Anchor + run tier-1 visitors").toBeDefined();
  }, 20_000);
});

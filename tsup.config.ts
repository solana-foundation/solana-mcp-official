import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as {
  dependencies?: Record<string, string>;
};

export default defineConfig({
  entry: ["api/start.ts"],
  // Emit CJS: several deps (fp-ts, etc.) expose CJS with directory sub-paths
  // that Node's ESM resolver rejects. CJS `require` handles them fine.
  format: ["cjs"],
  target: "node22",
  clean: true,
  outDir: "dist",
  dts: false,
  external: Object.keys(pkg.dependencies ?? {}),
});

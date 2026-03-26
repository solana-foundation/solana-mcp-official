import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "api/**/*.ts"],
      exclude: ["lib/context/**"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
    },
  },
});

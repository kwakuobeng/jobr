import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/{unit,integration,security,live}/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/resume/**/*.ts", "src/lib/ingestion/**/*.ts"],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
      reporter: ["text", "json-summary"],
    },
  },
});

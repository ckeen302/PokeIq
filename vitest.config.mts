import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Components render in a few tests (tsconfig keeps JSX for Next.js to compile).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Battle simulations run real games; a loaded CI runner can push one past the 5s default.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside React Server Components; it's a no-op for unit tests.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
});

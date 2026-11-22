import { defineConfig } from "vitest/config";
import path from "node:path";
import { createRequire } from "node:module";

// Translations compile from ICU text to icu-minify arrays, as next build does (scripts/i18n/icu-loader.cjs).
const icuLoader = createRequire(import.meta.url)("./scripts/i18n/icu-loader.cjs");
const MESSAGES = /[\\/]src[\\/]messages[\\/].+\.json$/;

export default defineConfig({
  plugins: [
    {
      name: "icu-messages",
      enforce: "pre",
      async transform(code: string, id: string) {
        if (!MESSAGES.test(id)) return null;
        return { code: JSON.stringify(icuLoader.compileTree(JSON.parse(code), await icuLoader.getCompile())), map: null };
      },
    },
  ],
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

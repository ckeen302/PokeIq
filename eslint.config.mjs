import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import i18next from "eslint-plugin-i18next";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** The folders whose screens are translated: their JSX text is checked for leftover literals. */
const I18N_DIRS = ["src/components/i18n"];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "e2e-screenshots/**",
      ".cache/**",
      "src/data/**",
    ],
  },
  // Languages: every link and navigation goes through the language-aware wrappers, so a page in another language
  // links to that language's pages (src/components/ui/Link.tsx, src/i18n/navigation.ts).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/Link.tsx", "src/components/ui/PlainLink.tsx", "src/i18n/**", "src/components/layout/RootChrome.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next/link", message: "Use @/components/ui/Link (or ui/PlainLink): it keeps the page's language." },
            { name: "next/navigation", importNames: ["useRouter", "usePathname"], message: "Use @/i18n/navigation: it keeps the page's language." },
            { name: "next/navigation", importNames: ["redirect", "permanentRedirect"], message: "Use redirect from @/i18n/server: it keeps the page's language." },
          ],
        },
      ],
    },
  },
  // Translated areas: text in JSX must come from src/messages (a warning while an area is being moved over).
  {
    files: I18N_DIRS.map((d) => `${d}/**/*.tsx`),
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["warn", { mode: "jsx-text-only" }],
    },
  },
];

export default eslintConfig;

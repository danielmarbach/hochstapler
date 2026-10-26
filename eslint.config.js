// Lint setup adopted from danielmarbach/mnemonic (eslint.config.js + eslint-rules/), extended for the
// monorepo (engine/server/client) and the typescript-code-review skill (curly, eqeqeq, exhaustiveness).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import security from "eslint-plugin-security";
import noUnsanitized from "eslint-plugin-no-unsanitized";

import noAwaitInPromiseAll from "./eslint-rules/no-await-in-promise-all.js";
import noBareTryCatch from "./eslint-rules/no-bare-try-catch.js";

const localPlugin = {
  rules: {
    "no-await-in-promise-all": noAwaitInPromiseAll,
    "no-bare-try-catch": noBareTryCatch,
  },
};

const SRC = ["packages/*/src/**/*.{ts,tsx}"];
const TESTS = ["packages/*/test/**/*.ts", "packages/*/src/**/*.test.ts", "e2e/**/*.ts"];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // All TypeScript: type-aware parsing
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "packages/*/vite.config.ts",
            "packages/*/vitest.config.ts",
            "playwright.config.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Source files
  {
    files: SRC,
    plugins: { local: localPlugin },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],

      "no-console": ["error", { allow: ["error", "warn"] }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",

      "local/no-await-in-promise-all": "error",
      "local/no-bare-try-catch": "error",

      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "Avoid enum declarations — use const object + 'as const' with derived type unions instead.",
        },
        {
          selector:
            "TSAsExpression[expression.callee.object.name='JSON'][expression.callee.property.name='parse']",
          message:
            "Type assertion on JSON.parse result bypasses validation — use a Zod schema instead.",
        },
      ],

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Security linting (docs/DESIGN.md #42): Node patterns everywhere in src, DOM sinks in the client.
  { files: SRC, ...security.configs.recommended },
  {
    files: SRC,
    rules: {
      // TypeScript-typed index access (noUncheckedIndexedAccess) makes this rule ~100% false positives here;
      // untrusted keys are validated with zod / hasOwnProperty instead (see docs/DESIGN.md #42).
      "security/detect-object-injection": "off",
    },
  },
  { files: ["packages/client/src/**/*.{ts,tsx}"], ...noUnsanitized.configs.recommended },

  // Server: console is the log sink; raw try/catch allowed at process/IO boundaries
  {
    files: ["packages/server/src/main.ts", "packages/server/src/db.ts"],
    rules: { "no-console": "off", "local/no-bare-try-catch": "off" },
  },
  {
    files: ["packages/server/src/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  // Client: browser globals + hooks rules (Preact uses the same hook semantics)
  {
    files: ["packages/client/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Tests — relaxed
  {
    files: TESTS,
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      "local/no-await-in-promise-all": "off",
      "local/no-bare-try-catch": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Scripts (Meshy pipeline, git hooks)
  {
    files: ["scripts/**/*.{ts,mjs,js}", "eslint-rules/**/*.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Prettier integration — MUST be last
  prettierConfig,
  {
    plugins: { prettier: prettierPlugin },
    rules: { "prettier/prettier": "error" },
  },

  {
    ignores: [
      ".claude/**",
      // own project (own lockfile, needs the Aspire CLI to generate its SDK): `npm run lint --prefix apphost`
      "apphost/**",
      "**/node_modules/",
      "**/dist/",
      "data/",
      "scripts/meshy/raw/",
      "packages/client/public/",
      "playwright-report/",
      "test-results/",
      ".features-gen/",
    ],
  },
);

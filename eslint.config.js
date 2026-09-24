import js from "@eslint/js";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  {
    // Only tests/**/*.js is plain, hand-written JS ESLint can parse. docs/*.js
    // is tsc-generated output (typed and gated by `tsc` itself, not linted as
    // source); src/**/*.ts is TypeScript, which the default parser can't read
    // — its safety net is the compiler, not ESLint.
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },
  prettierConfig,
  {
    ignores: ["node_modules/", "docs/*.js"],
  },
];

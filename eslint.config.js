"use strict";

const js = require("@eslint/js");
const globals = require("globals");
const prettierConfig = require("eslint-config-prettier");

const cascadeGlobals = {
  CascadeEngine: "readonly",
  CascadeAI: "readonly",
};

module.exports = [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
  {
    files: ["docs/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: globals.browser,
    },
  },
  {
    // engine.js/ai.js declare CascadeEngine/CascadeAI themselves (and
    // reference each other, where needed, via window.X); only app.js
    // consumes both as bare globals.
    files: ["docs/app.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, ...cascadeGlobals },
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, ...cascadeGlobals },
    },
  },
  prettierConfig,
  {
    ignores: ["node_modules/"],
  },
];

import globals from "globals";
import js from "@eslint/js";

export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021
      },
      ecmaVersion: 2021,
      sourceType: "module",
    },
    files: ["**/*.js"],
    ignores: ["node_modules/**", "dist/**", "build/**"],
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "brace-style": ["error", "1tbs"],
      "indent": ["error", 2],
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "no-var": "error",
      "object-shorthand": ["error", "always"],
      "prefer-template": "error",
      "no-param-reassign": "error",
      "max-len": ["error", { "code": 125 }],
      "no-constant-condition": ["error", { "checkLoops": false }],
    },
  },
];
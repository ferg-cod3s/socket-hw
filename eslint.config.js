import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    files: ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  prettierConfig,
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      ".next/**",
      "**/.next/**",
      "**/*.config.{js,mjs,cjs}",
      "**/bin/**",
      "**/*.cjs",
      "**/*.mjs",
      "**/coverage/**",
      "**/*.d.ts",
      "**/pnpm-lock.yaml",
      "**/.turbo/**",
    ],
  },
];

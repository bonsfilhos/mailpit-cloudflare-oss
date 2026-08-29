import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".wrangler/**",
      "coverage/**",
      "dist/**",
      "dist-worker/**",
      "node_modules/**",
      "src/ui/**",
      "vendor/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/worker/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
      parserOptions: { project: "./tsconfig.json" }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
);

// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/.next/**",
      "apps/web_legacy/**",
      "eslint.config.mjs",
      "vitest.config.ts",
      "vitest.workspace.ts",
      "**/vitest.config.ts",
      "**/postcss.config.mjs",
      "**/next.config.ts",
      "scripts/**",
    ],
  },
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);

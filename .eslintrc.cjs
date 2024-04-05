module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:@typescript-eslint/stylistic",
    "plugin:vitest/recommended",
  ],
  plugins: ["@typescript-eslint", "vitest"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  root: true,
  ignorePatterns: [
    "/build/**",
    "/node_modules/**",
    "/NetscriptDefinitions.d.ts",
    "/.eslintrc.cjs",
  ],
};

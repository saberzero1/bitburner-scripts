// Lint for real bugs (undefined variables, precedence slips, dead code), not style.
// Run with: npm run lint
import globals from "globals";

export default [
    { ignores: ["build/**", "node_modules/**", "sphyxos/**", "**/*.d.ts"] },
    {
        files: ["servers/**/*.js", "servers/**/*.jsx", "*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: {
                ...globals.browser,
                ...globals.node,
                // Provided by the game at runtime
                React: "readonly",
                ReactDOM: "readonly",
                webpackChunkbitburner: "readonly",
                webpack_require: "writable", // set on globalThis by achievements.js / dev-console.js
            },
        },
        rules: {
            "no-undef": "error",
            "no-constant-binary-expression": "error", // e.g. `x || 0 == 3`
            "no-unsafe-optional-chaining": "error",
            "no-unsafe-negation": "error",
            "no-const-assign": "error",
            "no-dupe-keys": "error",
            "no-dupe-else-if": "error",
            "no-duplicate-case": "error",
            "no-self-assign": "error",
            "no-self-compare": "error",
            "no-unreachable": "warn",
            "use-isnan": "error",
            "valid-typeof": "error",
            "getter-return": "error",
            "no-func-assign": "error",
            "no-import-assign": "error",
            "no-compare-neg-zero": "error",
            "no-sparse-arrays": "warn",
        },
    },
];

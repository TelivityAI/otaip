import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
    {
		files: ["**/*.ts", "**/*.cts", "**/*.mts"],
	},
    globalIgnores([
    "**/dist",
    "**/node_modules",
    "**/data",
    "**/*.js",
    "**/*.mjs",
    "**/__tests__/**/*",
    "**/scripts/**",
]), {

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",

        parserOptions: {
            project: [
                "./packages/core/tsconfig.json",
                "./packages/agents/reference/tsconfig.json",
                "./packages/agents/search/tsconfig.json",
                "./packages/agents/pricing/tsconfig.json",
                "./packages/agents/booking/tsconfig.json",
                "./packages/agents/ticketing/tsconfig.json",
                "./packages/agents/exchange/tsconfig.json",
                "./packages/agents/settlement/tsconfig.json",
                "./packages/agents/reconciliation/tsconfig.json",
                "./packages/agents/lodging/tsconfig.json",
                "./packages/agents-tmc/tsconfig.json",
                "./packages/agents-platform/tsconfig.json",
                "./packages/adapters/duffel/tsconfig.json",
                "./packages/adapters/hotelbeds/tsconfig.json",
                "./packages/connect/tsconfig.json",
                "./packages/cli/tsconfig.json",
                "./packages/integration/tsconfig.json",
            ],
        },
    },

    rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/explicit-function-return-type": "warn",

        "@typescript-eslint/no-unused-vars": ["error", {
            argsIgnorePattern: "^_",
        }],

        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/require-await": "off",

        "no-console": ["warn", {
            allow: ["warn", "error"],
        }],
    },
}, {
    // CLI is the one place where stdout output IS the contract.
    files: ["packages/cli/**/*.ts"],
    rules: {
        "no-console": "off",
    },
}]);
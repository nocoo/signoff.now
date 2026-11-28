import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		allowOnly: false,
		passWithNoTests: false,
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/__integration__/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: [
				"**/*.test.ts",
				"**/__integration__/**",
				"**/index.ts",
				"src/main.ts",
				"src/**/types.ts",
				"src/**/*.types.ts",
				// Process I/O adapters
				"src/executor/bun-executor.ts",
				// Filesystem cache store (Bun.file I/O)
				"src/identity/fs-cache-store.ts",
				// Test double used by unit tests (not production)
				"src/api/mock-client.ts",
			],
			thresholds: {
				statements: 90,
				functions: 90,
				lines: 90,
				branches: 85,
			},
		},
	},
});

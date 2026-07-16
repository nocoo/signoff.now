import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
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
				// Process I/O adapters — covered by integration tests
				"src/executor/bun-executor.ts",
				"src/executor/bun-fs-reader.ts",
				// Thin collector wrappers (logic lives in core + run-collectors)
				"src/commands/collectors/*.collector.ts",
				"src/commands/collectors/all.ts",
			],
			thresholds: {
				statements: 97,
				functions: 97,
				lines: 97,
				branches: 85,
			},
		},
	},
});

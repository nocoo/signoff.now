import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/migrate.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/worker-placeholder.ts",
				"src/index.ts",
			],
			thresholds: {
				statements: 95,
				functions: 95,
				lines: 95,
				branches: 90,
			},
		},
	},
});

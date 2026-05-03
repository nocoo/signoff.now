import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: ["**/*.test.ts", "**/index.ts"],
			thresholds: {
				statements: 85,
				functions: 90,
				lines: 85,
				branches: 75,
			},
		},
	},
});

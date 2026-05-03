import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			thresholds: {
				statements: 95,
				functions: 95,
				lines: 95,
				branches: 90,
			},
		},
	},
});

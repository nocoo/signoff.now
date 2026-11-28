import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	test: {
		allowOnly: false,
		passWithNoTests: false,
		environment: "node",
		maxWorkers: 4,
		globals: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			// Models + ViewModels + lib (Views and React provider .tsx glue excluded — docs/03)
			include: [
				"src/models/**/*.ts",
				"src/viewmodels/**/*.ts",
				"src/lib/**/*.ts",
			],
			exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/*.d.ts"],
			thresholds: {
				statements: 90,
				functions: 90,
				lines: 90,
				branches: 85,
			},
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify("0.0.1"),
	},
});

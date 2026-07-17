import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "happy-dom",
		globals: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			// Models + ViewModels + lib (Views still excluded — docs/03)
			include: [
				"src/models/**/*.{ts,tsx}",
				"src/viewmodels/**/*.{ts,tsx}",
				"src/lib/**/*.{ts,tsx}",
			],
			exclude: [
				"src/**/*.{test,spec}.{ts,tsx}",
				"src/**/*.d.ts",
				// HTTP clients: thin wrappers, mocked in ViewModel tests
				"src/models/*Api.ts",
			],
			thresholds: {
				statements: 95,
				functions: 95,
				lines: 95,
				branches: 95,
			},
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify("0.0.1"),
	},
});

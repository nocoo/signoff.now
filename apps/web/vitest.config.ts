import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "node",
		globals: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/models/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.{test,spec}.{ts,tsx}",
				"src/**/*.d.ts",
				"src/models/*Api.ts",
			],
			thresholds: {
				statements: 95,
				functions: 95,
				lines: 95,
				branches: 80,
			},
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify("0.0.1"),
	},
});

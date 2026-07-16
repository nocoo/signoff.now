import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		// node is enough for pure utils; switch to jsdom when component tests land
		environment: "node",
		globals: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.{test,spec}.{ts,tsx}",
				// Views excluded from coverage gate (see docs/01)
				"src/App.tsx",
				"src/main.tsx",
				"src/vite-env.d.ts",
				"src/**/views/**",
				"src/**/*.view.tsx",
			],
			// Hard gate: non-View code must stay ≥95%
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

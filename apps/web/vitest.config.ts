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
				"src/main.tsx",
				"src/vite-env.d.ts",
			],
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify("0.0.1"),
	},
});

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		conditions: ["import", "module", "node", "default"],
		alias: {
			main: resolve(__dirname, "src/main"),
			renderer: resolve(__dirname, "src/renderer"),
			shared: resolve(__dirname, "src/shared"),
			lib: resolve(__dirname, "src/lib"),
			preload: resolve(__dirname, "src/preload"),
		},
	},
	test: {
		environment: "node",
		server: {
			deps: {
				inline: ["zod"],
			},
		},
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"src/lib/trpc/routers/__tests__/e2e-smoke.test.ts",
			"src/lib/trpc/routers/__tests__/l2-integration.test.ts",
			"src/lib/trpc/routers/__tests__/l3-projects-crud.test.ts",
		],
		setupFiles: ["./test-setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: [
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/index.ts",
				"src/main/index.ts",
				"src/preload/**",
				"src/renderer/routeTree.gen.ts",
				"src/renderer/routes/**",
				"src/renderer/main.tsx",
				"src/**/types.ts",
				"src/**/*.types.ts",
				"src/resources/**",
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

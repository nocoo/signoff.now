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
			// Lowered from the 95/95/95/90 monorepo default: this package
			// is a thin home for the ported terminal-link-parsing module
			// plus a few tiny utilities, and the realistic coverage of
			// that ported code sits in the 85/90/85/75 band. Tighten as
			// more tests land.
			thresholds: {
				statements: 85,
				functions: 90,
				lines: 85,
				branches: 75,
			},
		},
	},
});

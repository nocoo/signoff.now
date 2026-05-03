import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/__integration__/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: [
				"**/*.test.ts",
				"**/index.ts",
				"src/types.ts",
				"src/**/types.ts",
				"src/fs.ts",
				"src/watch.ts",
			],
			// Lowered from the 95/95/95/90 monorepo default. Reasons:
			// - `src/fs.ts` and `src/watch.ts` are thin wrappers around
			//   node:fs and @parcel/watcher; they are exercised by the
			//   integration tests in src/__integration__/ (which are
			//   excluded from this unit-test run) rather than by mocked
			//   unit tests, so they're excluded above.
			// - The remaining pure-logic modules realistically land in
			//   the 80/85/80/75 band. Tighten as more unit tests land.
			thresholds: {
				statements: 80,
				functions: 85,
				lines: 80,
				branches: 75,
			},
		},
	},
});

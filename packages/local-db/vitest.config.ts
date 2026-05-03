import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		// Coverage notes:
		// Tests run under `bun --bun vitest` because of bun:sqlite. Neither
		// vitest coverage provider works in that runtime:
		//  - `v8`: bun does not expose the v8 coverage hooks vitest needs.
		//  - `istanbul`: tested against vitest 4.1; instrumentation hooks
		//    are not invoked under the bun runtime, so the report shows
		//    every file as 0% (gate becomes meaningless).
		// `test:coverage` therefore intentionally runs without `--coverage`.
		// The block below is preserved only so HTML reports can be
		// generated manually with `vitest run --coverage` under node.
		// schema.ts is exercised end-to-end by `apps/desktop` and the L4
		// integration tests, where coverage is enforced.
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: [
				"**/*.test.ts",
				"**/index.ts",
				"src/schema/**",
				"src/**/types.ts",
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

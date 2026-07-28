/**
 * A lint rule that lives in the test suite.
 *
 * The layout bugs this fixes were not one mistake; they were the same mistake
 * made independently on five pages, because nothing stopped a page from
 * hand-rolling a control. These checks fail the build when that starts again.
 */

import { describe, expect, it } from "vitest";

/**
 * Every view source, read through Vite rather than `node:fs` — this package
 * targets the browser and has no Node types, so an fs-based version compiles
 * nowhere and rots.
 */
const VIEWS = import.meta.glob("../views/**/*.tsx", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const entries = Object.entries(VIEWS);

/** Paths whose source matches, so a failure names the file to fix. */
function offenders(match: (src: string) => boolean): string[] {
	return entries
		.filter(([, src]) => match(src))
		.map(([path]) => path.replace("../", ""));
}

describe("views use the shared controls", () => {
	it("sees every view", () => {
		// Without this, a glob that silently matched nothing would make every
		// check below pass by looking at an empty list.
		expect(entries.length).toBeGreaterThan(5);
	});

	it("no page renders a bare <select>", () => {
		// A native select shows the browser's arrow jammed against the border,
		// which is the reported bug. Select redraws it inset.
		expect(offenders((src) => src.includes("<select"))).toEqual([]);
	});

	it("no page hand-rolls a control with border + height utilities", () => {
		// e.g. `h-9 rounded-md border border-border bg-background px-2` — one
		// page's idea of a control, drifting from Input by a padding step.
		expect(
			offenders((src) =>
				/className="[^"]*\bh-9\b[^"]*\bborder-border\b/.test(src),
			),
		).toEqual([]);
	});

	it("no page sets its own label gap", () => {
		// Field owns --control-gap. A page choosing space-y-1.5 next to another
		// choosing space-y-2 is how the same form ended up with two gaps.
		expect(
			offenders(
				(src) => /space-y-1(\.5)?"/.test(src) && src.includes("<Label"),
			),
		).toEqual([]);
	});

	it("no page pairs a Label with a control without htmlFor", () => {
		// `<Label>Org</Label>` above an Input is a label in appearance only:
		// clicking the text does nothing and it announces no name.
		expect(offenders((src) => /<Label>(?!\s*<)/.test(src))).toEqual([]);
	});
});

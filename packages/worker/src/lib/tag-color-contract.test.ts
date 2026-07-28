/**
 * The web app generates a colour for inline tag creation; this route validates
 * it. They live in different packages, so nothing else checks that the format
 * one produces is the format the other accepts — and it did not: the web side
 * first sent `hsl(10 62% 49%)`, which is a 400.
 *
 * The palette and conversion are duplicated here rather than imported: the
 * worker does not depend on the web app, and a shared import would only prove
 * the two agree with themselves.
 */

import { describe, expect, test } from "bun:test";
import { normalizeColor } from "./entities.js";

/** Same 36 swatches as apps/web/src/lib/avatar.ts. */
const PALETTE = [
	"0 62% 53%",
	"10 62% 49%",
	"20 62% 44%",
	"30 62% 40%",
	"40 62% 36%",
	"50 62% 32%",
	"60 62% 29%",
	"70 62% 30%",
	"80 62% 30%",
	"90 62% 31%",
	"100 62% 32%",
	"110 62% 32%",
	"120 62% 32%",
	"130 62% 32%",
	"140 62% 32%",
	"150 62% 32%",
	"160 62% 32%",
	"170 62% 31%",
	"180 62% 31%",
	"190 62% 35%",
	"200 62% 40%",
	"210 62% 46%",
	"220 62% 54%",
	"230 62% 59%",
	"240 62% 59%",
	"250 62% 59%",
	"260 62% 59%",
	"270 62% 58%",
	"280 62% 56%",
	"290 62% 52%",
	"300 62% 47%",
	"310 62% 48%",
	"320 62% 50%",
	"330 62% 51%",
	"340 62% 52%",
	"350 62% 53%",
];

function hex(swatch: string): string {
	const [h, s, l] = swatch
		.split(" ")
		.map((p) => Number.parseFloat(p))
		.map((n, i) => (i === 0 ? n : n / 100)) as [number, number, number];
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const rgb = [
		[c, x, 0],
		[x, c, 0],
		[0, c, x],
		[0, x, c],
		[x, 0, c],
		[c, 0, x],
	][Math.floor(h / 60) % 6] as [number, number, number];
	return `#${rgb
		.map((v) =>
			Math.round((v + m) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")
		.toUpperCase()}`;
}

describe("generated tag colours are accepted by this route", () => {
	test("every palette swatch survives normalizeColor", () => {
		for (const swatch of PALETTE) {
			expect(normalizeColor(hex(swatch))).toBe(hex(swatch));
		}
	});

	test("the CSS form is refused, which is what shipped broken", () => {
		expect(normalizeColor("hsl(10 62% 49%)")).toBeNull();
		expect(normalizeColor("10 62% 49%")).toBeNull();
	});
});

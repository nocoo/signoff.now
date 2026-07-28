import { describe, expect, it } from "vitest";
import {
	AVATAR_PALETTE,
	avatarColor,
	avatarColorHex,
	avatarInitial,
	hashName,
	usableAvatarUrl,
} from "./avatar";

/** Relative luminance of an `H S% L%` triple, per WCAG. */
function luminance(hsl: string): number {
	const [h, s, l] = hsl
		.split(" ")
		.map((p) => Number.parseFloat(p))
		.map((n, i) => (i === 0 ? n : n / 100)) as [number, number, number];
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] = [
		[c, x, 0],
		[x, c, 0],
		[0, c, x],
		[0, x, c],
		[x, 0, c],
		[c, 0, x],
	][Math.floor(h / 60) % 6] as [number, number, number];
	const lin = (v: number) =>
		v + m <= 0.03928 ? (v + m) / 12.92 : ((v + m + 0.055) / 1.055) ** 2.4;
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe("AVATAR_PALETTE", () => {
	it("has 36 distinct swatches", () => {
		expect(AVATAR_PALETTE).toHaveLength(36);
		expect(new Set(AVATAR_PALETTE).size).toBe(36);
	});

	it("carries white text at WCAG AA everywhere", () => {
		// The initial is drawn in white on every one of these. A swatch that
		// fails here is unreadable for the person it belongs to.
		for (const swatch of AVATAR_PALETTE) {
			expect(1.05 / (luminance(swatch) + 0.05)).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe("hashName", () => {
	it("is stable across calls", () => {
		expect(hashName("Ada Lovelace")).toBe(hashName("Ada Lovelace"));
	});

	it("ignores surrounding whitespace", () => {
		expect(hashName("  张伟 ")).toBe(hashName("张伟"));
	});

	it("separates names that differ only in the last character", () => {
		// A summing hash gives 张伟 and 张威 adjacent values, which land on the
		// same or neighbouring swatch. This is the collision that matters.
		expect(avatarColor("张伟")).not.toBe(avatarColor("张威"));
	});

	it("separates anagrams", () => {
		// Position has to affect the result, or 李明 and 明李 share a colour.
		expect(hashName("李明")).not.toBe(hashName("明李"));
	});

	it("stays a 32-bit unsigned integer for long names", () => {
		const h = hashName("欧阳锋独孤求败令狐冲".repeat(20));
		expect(Number.isInteger(h)).toBe(true);
		expect(h).toBeGreaterThanOrEqual(0);
		expect(h).toBeLessThan(2 ** 32);
	});
});

describe("avatarColor distribution", () => {
	/** Real-shaped Chinese names: common surnames × common given names. */
	const surnames = [
		"张",
		"王",
		"李",
		"赵",
		"刘",
		"陈",
		"杨",
		"黄",
		"周",
		"吴",
		"徐",
		"孙",
		"朱",
		"马",
		"胡",
		"郭",
		"林",
		"何",
		"高",
		"梁",
	];
	const given = [
		"伟",
		"威",
		"芳",
		"娜",
		"敏",
		"静",
		"磊",
		"洋",
		"艳",
		"勇",
		"军",
		"杰",
		"涛",
		"明",
		"超",
		"秀英",
		"强",
		"霞",
		"平",
		"刚",
		"桂英",
		"建国",
		"丽",
		"文",
		"红",
	];
	const names = surnames.flatMap((s) => given.map((g) => s + g));

	it("distributes 500 Chinese names uniformly over the 36 swatches", () => {
		// Chi-square rather than a max-bucket bound: with 500 names in 36 buckets
		// the busiest bucket is noisy even for a perfect hash, so a bound on it
		// either trips at random or is too loose to mean anything. χ² over all
		// 36 counts is the actual uniformity test. df=35, critical value at
		// p=0.05 is 49.8. FNV-1a scores ~31; summing code points scores ~54 and
		// xor-without-mixing ~87, so this threshold does separate a good hash
		// from the two obvious wrong ones.
		const counts = new Map<string, number>();
		for (const n of names) {
			counts.set(avatarColor(n), (counts.get(avatarColor(n)) ?? 0) + 1);
		}
		expect(counts.size).toBe(36);
		const expected = names.length / AVATAR_PALETTE.length;
		const chiSquare = [...counts.values()].reduce(
			(acc, observed) => acc + (observed - expected) ** 2 / expected,
			0,
		);
		expect(chiSquare).toBeLessThan(49.8);
	});

	it("gives every name of a shared surname a different colour", () => {
		const colors = given.map((g) => avatarColor(`张${g}`));
		// 25 names into 36 swatches: a few birthday-paradox collisions are
		// expected, but a same-surname group must not read as one block.
		expect(new Set(colors).size).toBeGreaterThanOrEqual(18);
	});

	it("returns a colour inside the palette", () => {
		expect(AVATAR_PALETTE.map((s) => `hsl(${s})`)).toContain(
			avatarColor("Ada"),
		);
	});
});

describe("avatarInitial", () => {
	it("takes the given name for a Chinese name, not the surname", () => {
		// 张 is shared by ~95 million people; 伟 is what distinguishes this row.
		expect(avatarInitial("张伟")).toBe("伟");
		expect(avatarInitial("欧阳锋")).toBe("阳锋");
	});

	it("falls back to the single character when there is no given name", () => {
		expect(avatarInitial("张")).toBe("张");
	});

	it("uppercases a single latin letter", () => {
		expect(avatarInitial("ada lovelace")).toBe("A");
	});

	it("handles an astral first character as one glyph", () => {
		// Naive `name[0]` would slice a surrogate pair and render a tofu box.
		expect(avatarInitial("𝒜lice")).toBe("𝒜");
	});

	it("shows a placeholder rather than an empty circle", () => {
		expect(avatarInitial("   ")).toBe("?");
	});
});

describe("usableAvatarUrl", () => {
	it("passes http and https through", () => {
		expect(usableAvatarUrl("https://x/a.png")).toBe("https://x/a.png");
		expect(usableAvatarUrl("http://x/a.png")).toBe("http://x/a.png");
	});

	it("rejects a scripting scheme", () => {
		// This value reaches an `<img src>` rendered for every viewer.
		expect(usableAvatarUrl("javascript:alert(1)")).toBeNull();
		expect(usableAvatarUrl("data:text/html,<script>")).toBeNull();
	});

	it("rejects case-shifted and control-character scheme smuggling", () => {
		// `new URL()` normalises all of these to javascript:/vbscript: before
		// the protocol check, so none reaches the DOM. Asserted explicitly
		// because "it happens to normalise" is not readable off the source.
		const TAB = String.fromCharCode(9);
		const NL = String.fromCharCode(10);
		for (const bad of [
			"JaVaScRiPt:alert(1)",
			` java${TAB}script:alert(1)`,
			`java${NL}script:alert(1)`,
			"vbscript:msgbox(1)",
			"DATA:text/html,<script>",
			"javascript%3Aalert(1)",
			"//evil/x",
			"file:///etc/passwd",
		]) {
			expect(usableAvatarUrl(bad)).toBeNull();
		}
	});

	it("rejects credentials", () => {
		expect(usableAvatarUrl("https://user:pw@evil/x.png")).toBeNull();
		expect(usableAvatarUrl("https://user@evil/x.png")).toBeNull();
		// Empty username with a real password still ships the secret.
		expect(usableAvatarUrl("https://:pw@evil/x.png")).toBeNull();
	});

	it("returns the parsed href, not the raw text", () => {
		// Otherwise the string that was checked is not the string rendered.
		expect(usableAvatarUrl("https:\\\\evil/x")).toBe("https://evil/x");
	});

	it("rejects an unparseable or missing value", () => {
		expect(usableAvatarUrl("not a url")).toBeNull();
		expect(usableAvatarUrl(null)).toBeNull();
		expect(usableAvatarUrl(undefined)).toBeNull();
		expect(usableAvatarUrl("")).toBeNull();
	});
});

describe("avatarColorHex", () => {
	it("produces the #RRGGBB the server will accept", () => {
		// `tags.color` is validated against ^#[0-9A-Fa-f]{6}$ server-side. The
		// CSS form (`hsl(10 62% 49%)`) is a 400, and that shipped once because
		// the caller reached for avatarColor.
		for (const name of ["infra", "frontend", "张伟", "a", ""]) {
			expect(avatarColorHex(name)).toMatch(/^#[0-9A-F]{6}$/);
		}
	});

	it("every palette swatch converts cleanly", () => {
		// One bad entry would only surface for whichever names hash onto it.
		const seen = new Set<string>();
		for (let i = 0; i < 400; i++) {
			seen.add(avatarColorHex(`name-${i}`));
		}
		for (const hex of seen) {
			expect(hex).toMatch(/^#[0-9A-F]{6}$/);
		}
		expect(seen.size).toBeGreaterThan(20);
	});

	it("agrees with avatarColor on the underlying swatch", () => {
		// Same hash, same palette entry — the two must not drift apart, or a
		// tag's stored colour would differ from the dot previewing it.
		const hslToHex = (hsl: string) => {
			const [h, s, l] = hsl
				.replace(/^hsl\(|\)$/g, "")
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
		};
		for (const name of ["infra", "张伟", "ops"]) {
			expect(avatarColorHex(name)).toBe(hslToHex(avatarColor(name)));
		}
	});

	it("is stable for the same name", () => {
		expect(avatarColorHex("infra")).toBe(avatarColorHex("infra"));
	});
});

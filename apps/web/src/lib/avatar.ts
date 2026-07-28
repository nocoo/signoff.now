/**
 * Generated avatars: an initial on a colour derived from the name.
 *
 * The colour has to be stable — the same person keeps the same swatch across
 * reloads, machines and pages — and it has to spread. Chinese names are the
 * hard case: they are two or three characters drawn from a narrow band of the
 * BMP, and a hash that sums code points collides constantly (张伟 and 张威 land
 * on the same value under addition). FNV-1a mixes each code point through a
 * multiply, so position and value both matter.
 */

/**
 * 36 hues at a lightness chosen per hue so white text clears WCAG AA (4.5:1).
 * Yellow-green needs a much darker L than blue for the same contrast, which is
 * why these are not one flat lightness.
 */
export const AVATAR_PALETTE = [
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
] as const;

/** FNV-1a over Unicode code points, kept in 32-bit unsigned range. */
export function hashName(name: string): number {
	let h = 0x811c9dc5;
	for (const ch of name.trim()) {
		h ^= ch.codePointAt(0) as number;
		// FNV prime 16777619, via shifts because `h * 16777619` overflows the
		// float53 mantissa and loses the low bits that carry the mixing.
		h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
	}
	return h;
}

export function avatarColor(name: string): string {
	return `hsl(${AVATAR_PALETTE[hashName(name) % AVATAR_PALETTE.length]})`;
}

/**
 * The glyph shown when there is no image.
 *
 * Latin names are commonly "Ada Lovelace", where the leading letter reads as
 * the person; Chinese names are commonly 张伟, where the leading character is
 * the surname and shared by millions, so the two trailing characters carry the
 * identity. Hence CJK takes the given name, everything else takes one letter.
 */
export function avatarInitial(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return "?";
	}
	const chars = [...trimmed];
	const cjk = /\p{Script=Han}/u;
	if (cjk.test(chars[0] as string)) {
		return chars.length > 1 ? chars.slice(1, 3).join("") : (chars[0] as string);
	}
	return (chars[0] as string).toUpperCase();
}

/**
 * Only http(s) images are rendered. The server already refuses anything else on
 * write, but a row predating that check — or one written by another client —
 * must not put a `javascript:` URL into an `<img src>`.
 *
 * Returns the PARSED href so the value that passed the check is the value that
 * gets rendered; `https:\\evil/x` and `https://evil/x` are the same request but
 * different strings. Credentials are refused outright: they are never
 * legitimate in an image URL and would leak to every viewer.
 */
export function usableAvatarUrl(url: string | null | undefined): string | null {
	if (!url) {
		return null;
	}
	try {
		const u = new URL(url);
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			return null;
		}
		return u.username || u.password ? null : u.href;
	} catch {
		return null;
	}
}

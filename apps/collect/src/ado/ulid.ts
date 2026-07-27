/**
 * ULID generation for run ids.
 *
 * The ingest contract accepts a ULID or a UUIDv4 (`ingest.ts`), and run ids
 * benefit from ULID's lexicographic time ordering: `.data/meta/runs/` sorts
 * chronologically, which matters when crash recovery replays manifests.
 *
 * Deriving one by concatenating strings does not work — the alphabet excludes
 * I, L, O and U, and the length is fixed at 26 — so ids must come from here.
 */

/** Crockford base32, minus the letters that look like digits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: number, length: number): string {
	let out = "";
	let v = value;
	for (let i = 0; i < length; i++) {
		out = (ALPHABET[v % 32] as string) + out;
		v = Math.floor(v / 32);
	}
	return out;
}

/**
 * A ULID for `timestampMs`.
 *
 * `random` is injectable so tests get deterministic ids without stubbing
 * globals; production passes nothing and gets crypto randomness.
 */
export function ulid(
	timestampMs: number = Date.now(),
	random: () => number = () => {
		const buf = new Uint8Array(1);
		crypto.getRandomValues(buf);
		return (buf[0] as number) / 256;
	},
): string {
	let suffix = "";
	for (let i = 0; i < 16; i++) {
		suffix += ALPHABET[Math.floor(random() * 32) % 32] as string;
	}
	return encode(timestampMs, 10) + suffix;
}

/**
 * A distinct ULID derived from a base one, keeping its timestamp prefix.
 *
 * A collect run emits several artifacts, each needing its own run id so the
 * server treats them as separate runs; sharing one would make chunk 0 of the
 * second artifact look like a duplicate of the first.
 */
export function derivedUlid(base: string, index: number): string {
	if (base.length !== 26) {
		return ulid();
	}
	const prefix = base.slice(0, 20);
	return prefix + encode(index, 6);
}

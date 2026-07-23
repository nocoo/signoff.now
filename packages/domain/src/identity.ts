/**
 * matchDeveloper — 01/02 identity: alias@suffix ≡ uniqueName (case-insensitive).
 */

export function matchDeveloper(
	uniqueName: string,
	developers: readonly { id: string; alias: string }[],
	suffixes: readonly string[],
): { id: string } | null {
	const u = uniqueName.trim().toLowerCase();
	if (!u || suffixes.length === 0) {
		return null;
	}
	const hits: string[] = [];
	for (const d of developers) {
		const alias = d.alias.trim();
		if (!alias) {
			continue;
		}
		for (const suffix of suffixes) {
			const s = suffix.trim();
			if (!s) {
				continue;
			}
			const candidate = `${alias}@${s}`.toLowerCase();
			if (candidate === u) {
				hits.push(d.id);
				break;
			}
		}
	}
	if (hits.length === 0) {
		return null;
	}
	hits.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const id = hits[0];
	if (id === undefined) {
		return null;
	}
	return { id };
}

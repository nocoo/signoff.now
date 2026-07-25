/**
 * Minimal SQL tokenizer for structural assertions about generated statements.
 *
 * Regex over raw SQL cannot tell a comment from a string literal: `'/*'` is a
 * literal, not a comment opener, so naive stripping can erase real code — or
 * be used to hide it. This walks the text once, tracking which construct it is
 * inside, and returns the statement with comments removed and literals
 * replaced by a placeholder. What survives is code, and only code.
 */

export type SqlShape = {
	/** Comments removed, string/identifier literals blanked to `''`. */
	code: string;
	/** Uppercased keyword sequence, whitespace-collapsed. */
	tokens: string;
};

export function sqlShape(sql: string): SqlShape {
	let out = "";
	let i = 0;

	while (i < sql.length) {
		const two = sql.slice(i, i + 2);

		if (two === "--") {
			const end = sql.indexOf("\n", i);
			i = end === -1 ? sql.length : end;
			out += " ";
			continue;
		}

		if (two === "/*") {
			const end = sql.indexOf("*/", i + 2);
			i = end === -1 ? sql.length : end + 2;
			out += " ";
			continue;
		}

		const ch = sql[i] as string;

		// Single-quoted string literal; '' is an escaped quote.
		if (ch === "'") {
			i++;
			while (i < sql.length) {
				if (sql[i] === "'") {
					if (sql[i + 1] === "'") {
						i += 2;
						continue;
					}
					i++;
					break;
				}
				i++;
			}
			out += "''";
			continue;
		}

		// Double-quoted or bracketed identifier.
		if (ch === '"' || ch === "[") {
			const close = ch === '"' ? '"' : "]";
			i++;
			while (i < sql.length && sql[i] !== close) {
				i++;
			}
			i++;
			out += '""';
			continue;
		}

		out += ch;
		i++;
	}

	const code = out.replace(/\s+/g, " ").trim();
	return { code, tokens: code.toUpperCase() };
}

/** True when the statement is an INSERT into `table` (comments/literals aside). */
export function isInsertInto(sql: string, table: string): boolean {
	const { tokens } = sqlShape(sql);
	return new RegExp(
		`^INSERT\\b[^;]*?\\bINTO\\s+${table.toUpperCase()}\\b`,
	).test(tokens);
}

/** True when the statement uses any upsert/replace form. */
export function hasUpsert(sql: string): boolean {
	const { tokens } = sqlShape(sql);
	return (
		/\bON\s+CONFLICT\b/.test(tokens) ||
		/\bINSERT\s+OR\s+(REPLACE|IGNORE)\b/.test(tokens) ||
		/^\s*REPLACE\s+INTO\b/.test(tokens)
	);
}

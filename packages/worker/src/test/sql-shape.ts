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

/** Index just past a comment starting at `i`, or -1 if none starts there. */
function skipComment(sql: string, i: number): number {
	const two = sql.slice(i, i + 2);
	if (two === "--") {
		const end = sql.indexOf("\n", i);
		return end === -1 ? sql.length : end;
	}
	if (two === "/*") {
		const end = sql.indexOf("*/", i + 2);
		return end === -1 ? sql.length : end + 2;
	}
	return -1;
}

/**
 * Index just past a quoted run starting at `i`, or -1 if none starts there.
 * Covers '…' literals and "…" / [ … ] / `…` identifiers; a doubled closing
 * character is an escape, not a terminator.
 */
function skipQuoted(sql: string, i: number): number {
	const open = sql[i];
	const close =
		open === "'"
			? "'"
			: open === '"'
				? '"'
				: open === "["
					? "]"
					: open === "`"
						? "`"
						: "";
	if (!close) {
		return -1;
	}
	let j = i + 1;
	while (j < sql.length) {
		if (sql[j] === close) {
			if (close !== "]" && sql[j + 1] === close) {
				j += 2;
				continue;
			}
			return j + 1;
		}
		j++;
	}
	return sql.length;
}

export function sqlShape(sql: string): SqlShape {
	let out = "";
	let i = 0;

	while (i < sql.length) {
		const afterComment = skipComment(sql, i);
		if (afterComment !== -1) {
			i = afterComment;
			out += " ";
			continue;
		}

		const afterQuoted = skipQuoted(sql, i);
		if (afterQuoted !== -1) {
			out += sql[i] === "'" ? "''" : '""';
			i = afterQuoted;
			continue;
		}

		out += sql[i];
		i++;
	}

	const code = out.replace(/\s+/g, " ").trim();
	return { code, tokens: code.toUpperCase() };
}

/**
 * True when the statement writes rows into `table`, however it is spelled:
 * INSERT / INSERT OR ... / REPLACE, optionally behind a CTE, and with the
 * target quoted (`"t"`, `[t]`, `` `t` ``) or schema-qualified (`main.t`).
 *
 * Quoted targets are recovered from the raw SQL because `sqlShape` blanks
 * identifiers; matching only the blanked form would let a rename hide.
 */
export function isWriteInto(sql: string, table: string): boolean {
	const { tokens } = sqlShape(sql);
	const T = table.toUpperCase();
	// Blanked identifiers become "" — treat that as a wildcard target and fall
	// back to checking the raw text for the table name in quotes.
	const quoted = new RegExp(`["'\`\\[]\\s*${table}\\s*["'\`\\]]`, "i").test(
		sql,
	);
	const verb = /\b(INSERT|REPLACE)\b[^;]*?\bINTO\s+([A-Z0-9_]+\.)?/;
	const m = verb.exec(tokens);
	if (!m) {
		return false;
	}
	const after = tokens.slice((m.index ?? 0) + m[0].length);
	return after.startsWith(T) || (quoted && after.startsWith('""'));
}

/** Back-compat alias: reads better at call sites that only ever see INSERT. */
export const isInsertInto = isWriteInto;

/** True when the statement uses any upsert/replace form. */
export function hasUpsert(sql: string): boolean {
	const { tokens } = sqlShape(sql);
	return (
		/\bON\s+CONFLICT\b/.test(tokens) ||
		/\bINSERT\s+OR\s+(REPLACE|IGNORE)\b/.test(tokens) ||
		/\bREPLACE\s+INTO\b/.test(tokens)
	);
}

/**
 * Extract the right-hand side of `SET <column> = ...` up to the next clause.
 * Used to assert an assignment's exact form instead of probing values: no
 * finite set of seeds can rule out a cap or modulo that only differs outside
 * the sampled range, but reading the SQL can.
 */
export function setExpression(sql: string, column: string): string | null {
	const { code } = sqlShape(sql);
	const setIdx = code.search(/\bSET\b/i);
	if (setIdx === -1) {
		return null;
	}
	const re = new RegExp(`\\b${column}\\s*=\\s*`, "i");
	const m = re.exec(code.slice(setIdx));
	if (!m) {
		return null;
	}

	// Scan to the assignment's end, tracking nesting so a comma inside a call
	// like MIN(x, 100) does not look like the next assignment.
	let i = setIdx + (m.index ?? 0) + m[0].length;
	const start = i;
	let depth = 0;
	while (i < code.length) {
		const ch = code[i] as string;
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			if (depth === 0) {
				break;
			}
			depth--;
		} else if (depth === 0) {
			if (ch === ",") {
				break;
			}
			if (/\s/.test(ch) && /^\s+(WHERE|RETURNING)\b/i.test(code.slice(i))) {
				break;
			}
		}
		i++;
	}
	const expr = code.slice(start, i).trim();
	return expr.length > 0 ? expr : null;
}

/**
 * Extract the full parenthesised condition of the `if` whose head contains
 * `needle`, brace-matched across newlines.
 *
 * Grepping a single line is not enough: reformatting the same condition across
 * several lines moves an added term onto a line the grep never inspects, and
 * the check silently passes. Returning the whole condition removes that
 * degree of freedom. Returns null when no such `if` exists, so a caller that
 * asserts on the result fails closed if the code is restructured.
 */
export function ifConditionContaining(
	source: string,
	needle: string,
): string | null {
	const at = source.indexOf(needle);
	if (at === -1) {
		return null;
	}
	// Walk back to the nearest `if (` that opens before the needle.
	const head = source.lastIndexOf("if (", at);
	if (head === -1) {
		return null;
	}

	let i = head + "if ".length;
	let depth = 0;
	const start = i;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
			if (depth === 0) {
				const cond = source.slice(start + 1, i);
				// The needle must be inside this condition, not after it.
				return cond.includes(needle) ? cond.replace(/\s+/g, " ").trim() : null;
			}
		}
		i++;
	}
	return null;
}

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
	// Identifier boundary: `ingest_runs_archive` must not match `ingest_runs`.
	const bare = new RegExp(`^${T}(?![A-Z0-9_])`).test(after);
	return bare || (quoted && after.startsWith('""'));
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
	const assignments = setAssignments(sql);
	const hits = assignments.filter(
		(a) => a.column.toUpperCase() === column.toUpperCase(),
	);
	// More than one assignment to the same column: SQLite keeps the last, so
	// reporting the first would describe behaviour that never happens. Refuse
	// to answer rather than mislead the caller.
	if (hits.length !== 1) {
		return null;
	}
	return hits[0]?.expr ?? null;
}

/**
 * All top-level `col = expr` pairs in the statement's SET list, in order.
 *
 * Parsed rather than pattern-matched: a `seen_count = seen_count + 1` sitting
 * in a WHERE clause, or a second assignment to the same column later in the
 * list, both make a naive search report an expression that does not govern the
 * write. Nested parens and quoted spans are skipped via `sqlShape`.
 */
export function setAssignments(
	sql: string,
): { column: string; expr: string }[] {
	const { code } = sqlShape(sql);
	const setIdx = code.search(/\bSET\b/i);
	if (setIdx === -1) {
		return [];
	}

	const out: { column: string; expr: string }[] = [];
	let i = setIdx + 3;
	while (i < code.length) {
		const rest = code.slice(i);
		const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/.exec(rest);
		if (!m) {
			// Unsupported SET syntax (quoted column, tuple assignment, …). A
			// partial list would let a later assignment hide, so report none:
			// callers assert an exact expression and so fail closed on null.
			if (/^\s*["'`[(]/.test(rest)) {
				return [];
			}
			break;
		}
		i += m[0].length;
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
				if (/^\s+(WHERE|RETURNING|FROM)\b/i.test(code.slice(i))) {
					break;
				}
			}
			i++;
		}
		out.push({ column: m[1] as string, expr: code.slice(start, i).trim() });
		if (code[i] !== ",") {
			break;
		}
		i++;
	}
	return out;
}

/**
 * Condition of the `if` whose body contains `bodyMarker`.
 *
 * Anchoring on the guard's OUTCOME rather than on its condition text is what
 * makes this honest: a decoy `if` mentioning the same comparison, or an index
 * hidden behind a local alias, cannot redirect the check. The returned
 * condition is expanded so single-token aliases assigned from a property read
 * (`const i = body.chunkIndex`) are visible as their source expression.
 *
 * Returns null when no such `if` is found, so callers fail closed.
 */
export function guardConditionFor(
	source: string,
	bodyMarker: string,
): string | null {
	const at = source.indexOf(bodyMarker);
	if (at === -1) {
		return null;
	}

	// Walk back over `if (...) {` heads, choosing the innermost one whose body
	// still contains the marker.
	let best: string | null = null;
	let searchFrom = 0;
	while (true) {
		const head = source.indexOf("if (", searchFrom);
		if (head === -1 || head > at) {
			break;
		}
		const cond = readParenSpan(source, head + 2);
		if (cond) {
			const braceOpen = source.indexOf("{", cond.end);
			if (braceOpen !== -1) {
				const braceClose = matchBrace(source, braceOpen);
				if (braceOpen < at && at < braceClose) {
					best = cond.text;
				}
			}
		}
		searchFrom = head + 1;
	}
	if (best === null) {
		return null;
	}

	// Inline single-assignment aliases so `const i = body.chunkIndex; ... i < 2`
	// is not mistaken for an index-free condition. Iterate to a fixed point: a
	// chain (`const a = body.chunkIndex; const b = a <= 1;`) needs more than one
	// pass, and a single pass is also sensitive to declaration order.
	const aliases = new Map<string, string>();
	for (const m of source.matchAll(
		/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+);/g,
	)) {
		aliases.set(m[1] as string, (m[2] as string).trim());
	}

	let expanded = best;
	for (let pass = 0; pass < 8; pass++) {
		let next = expanded;
		for (const [name, value] of aliases) {
			next = next.replace(new RegExp(`\\b${name}\\b`, "g"), `(${value})`);
		}
		if (next === expanded) {
			break;
		}
		expanded = next;
	}
	return expanded.replace(/\s+/g, " ").trim();
}

function readParenSpan(
	source: string,
	openIdx: number,
): { text: string; end: number } | null {
	let i = openIdx;
	while (i < source.length && source[i] !== "(") {
		i++;
	}
	let depth = 0;
	const start = i;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
			if (depth === 0) {
				return {
					text: source
						.slice(start + 1, i)
						.replace(/\s+/g, " ")
						.trim(),
					end: i + 1,
				};
			}
		}
		i++;
	}
	return null;
}

function matchBrace(source: string, openIdx: number): number {
	let depth = 0;
	for (let i = openIdx; i < source.length; i++) {
		if (source[i] === "{") {
			depth++;
		} else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
	}
	return source.length;
}

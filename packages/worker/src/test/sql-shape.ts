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
 * INSERT / INSERT OR ... / REPLACE / UPDATE, optionally behind a CTE, with the
 * target quoted (`"t"`, `[t]`, `` `t` ``) or schema-qualified (`main.t`).
 *
 * `sqlShape` blanks quoted identifiers, so a quoted target must be recovered
 * from the raw SQL. The recovery is anchored at the SAME OFFSET the verb was
 * found at — a free-floating search would let
 * `INSERT INTO "other" (a) SELECT 1 AS "ingest_runs"` claim to write
 * `ingest_runs`, which is exactly backwards: it writes somewhere else.
 */
export function isWriteInto(sql: string, table: string): boolean {
	const { tokens } = sqlShape(sql);
	const T = table.toUpperCase();

	// INSERT/REPLACE name the target after INTO; UPDATE names it immediately.
	const verb =
		/\b(?:INSERT|REPLACE)\b[^;]*?\bINTO\s+(?:[A-Z0-9_]+\.)?|\bUPDATE\s+(?:OR\s+[A-Z]+\s+)?(?:[A-Z0-9_]+\.)?/;
	const m = verb.exec(tokens);
	if (!m) {
		return false;
	}
	const at = (m.index ?? 0) + m[0].length;
	const after = tokens.slice(at);

	// Identifier boundary: `ingest_runs_archive` must not match `ingest_runs`.
	if (new RegExp(`^${T}(?![A-Z0-9_])`).test(after)) {
		return true;
	}
	// A blanked identifier sits where the target should be. Read the raw SQL at
	// that same position to find out what it actually was.
	if (!after.startsWith('""')) {
		return false;
	}
	const rawTarget = /^\s*["'`[]\s*([A-Za-z0-9_]+)\s*["'`\]]/.exec(
		sql.slice(at),
	);
	return rawTarget?.[1]?.toUpperCase() === T;
}

/**
 * INSERT/REPLACE only — deliberately NOT an alias of `isWriteInto`.
 *
 * Call sites that ask "which batch inserts this row" mean insertion. Aliasing
 * the two made `isInsertInto` start matching UPDATE, which turned "exactly one
 * batch inserts the run" into a false failure against a statement that only
 * guards on the row's existence.
 */
export function isInsertInto(sql: string, table: string): boolean {
	return /\b(?:INSERT|REPLACE)\b/.test(sqlShape(sql).tokens)
		? isWriteInto(sql, table)
		: false;
}

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
	// `if(` with no space is valid JS and Biome will not reformat inside a
	// string, so matching a literal "if (" would silently find no guard at all
	// and the caller would fail closed on a guard that is present.
	const ifHead = /\bif\s*\(/g;
	while (true) {
		ifHead.lastIndex = searchFrom;
		const found = ifHead.exec(source);
		const head = found?.index ?? -1;
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

/**
 * Whether the `/` at `idx` opens a regex literal rather than dividing.
 *
 * JS decides this by what came before: after a value (identifier, literal,
 * closing bracket) it is division; after an operator, `(`, `,` or the start of
 * an expression it opens a regex.
 */
function opensRegex(source: string, idx: number): boolean {
	let k = idx - 1;
	while (k >= 0 && /\s/.test(source[k] as string)) {
		k--;
	}
	if (k < 0) {
		return true;
	}
	const prev = source[k] as string;
	return !/[A-Za-z0-9_$)\]]/.test(prev);
}

/** Index just past the closing `/` of the regex literal starting at `idx`. */
function endOfRegex(source: string, idx: number): number {
	let j = idx + 1;
	let inClass = false;
	while (j < source.length) {
		const c = source[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "[") {
			inClass = true;
		} else if (c === "]") {
			inClass = false;
		} else if (c === "/" && !inClass) {
			break;
		}
		j++;
	}
	return j + 1;
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
	// Parens inside a string or a comment are text, not structure. Counting
	// them truncated `if (msg === "a) b" && n > 0)` to `msg === "a`, so a guard
	// could be rewritten past the cut and the assertion would still pass.
	let quote: string | null = null;
	while (i < source.length) {
		const ch = source[i] as string;
		const prev = source[i - 1];
		if (quote) {
			if (ch === quote && prev !== "\\") {
				quote = null;
			}
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			i++;
			continue;
		}
		// A regex literal can carry parens too: `if (/a)b/.test(x) && n > 0)`
		// truncated to `/a`. Told apart from division by what precedes it —
		// after a value, `/` divides; after an operator or `(`, it opens a regex.
		if (ch === "/" && opensRegex(source, i)) {
			i = endOfRegex(source, i);
			continue;
		}
		if (ch === "/" && source[i + 1] === "/") {
			const nl = source.indexOf("\n", i);
			i = nl === -1 ? source.length : nl;
			continue;
		}
		if (ch === "/" && source[i + 1] === "*") {
			const close = source.indexOf("*/", i + 2);
			i = close === -1 ? source.length : close + 2;
			continue;
		}
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

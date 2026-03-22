/**
 * Language detection — maps file extensions to CodeMirror language support.
 *
 * Pure function for easy testing. Returns a language identifier
 * or null for unrecognized extensions.
 */

/** Supported language identifiers. */
export type LanguageId =
	| "javascript"
	| "typescript"
	| "jsx"
	| "tsx"
	| "python"
	| "json"
	| "markdown"
	| "html"
	| "css"
	| "yaml"
	| "sql";

/** Map file extension (without dot) to language ID. */
export function detectLanguage(filename: string): LanguageId | null {
	const ext = filename.split(".").pop()?.toLowerCase();
	if (!ext) return null;

	const map: Record<string, LanguageId> = {
		js: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		jsx: "jsx",
		ts: "typescript",
		mts: "typescript",
		cts: "typescript",
		tsx: "tsx",
		py: "python",
		pyw: "python",
		json: "json",
		jsonc: "json",
		md: "markdown",
		mdx: "markdown",
		html: "html",
		htm: "html",
		css: "css",
		scss: "css",
		less: "css",
		yaml: "yaml",
		yml: "yaml",
		sql: "sql",
	};

	return map[ext] ?? null;
}

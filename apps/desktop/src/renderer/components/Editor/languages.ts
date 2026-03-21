/**
 * Language detection — maps file extensions to CodeMirror language support.
 *
 * Pure function for easy testing. Returns a LanguageSupport instance
 * or null for unrecognized extensions.
 */

import type { LanguageSupport } from "@codemirror/language";

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

/**
 * Lazily load the CodeMirror language extension for a given language ID.
 * Returns null for unsupported languages.
 */
export async function loadLanguage(
	langId: LanguageId,
): Promise<LanguageSupport | null> {
	switch (langId) {
		case "javascript":
		case "jsx": {
			const { javascript } = await import("@codemirror/lang-javascript");
			return javascript({ jsx: langId === "jsx" });
		}
		case "typescript":
		case "tsx": {
			const { javascript } = await import("@codemirror/lang-javascript");
			return javascript({
				jsx: langId === "tsx",
				typescript: true,
			});
		}
		case "python": {
			const { python } = await import("@codemirror/lang-python");
			return python();
		}
		case "json": {
			const { json } = await import("@codemirror/lang-json");
			return json();
		}
		case "markdown": {
			const { markdown } = await import("@codemirror/lang-markdown");
			return markdown();
		}
		case "html": {
			const { html } = await import("@codemirror/lang-html");
			return html();
		}
		case "css": {
			const { css } = await import("@codemirror/lang-css");
			return css();
		}
		case "yaml": {
			const { yaml } = await import("@codemirror/lang-yaml");
			return yaml();
		}
		case "sql": {
			const { sql } = await import("@codemirror/lang-sql");
			return sql();
		}
		default:
			return null;
	}
}

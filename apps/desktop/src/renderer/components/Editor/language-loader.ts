/**
 * Language loader — browser-only CodeMirror language extension loading.
 *
 * Lazily loads CodeMirror language packages via dynamic import.
 * This module depends on browser globals (document, navigator) that
 * CodeMirror packages require at import time. Not testable in Bun.
 *
 * Split from languages.ts to keep the testable detectLanguage function
 * in a fully covered module.
 */

import type { LanguageSupport } from "@codemirror/language";
import type { LanguageId } from "./languages";

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

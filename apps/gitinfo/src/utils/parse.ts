/**
 * Split NUL-delimited output into tokens, filtering empty trailing tokens.
 */
export function splitNul(output: string): string[] {
	if (output === "") return [];
	const parts = output.split("\0");
	// Remove trailing empty string from final NUL
	if (parts.length > 0 && parts[parts.length - 1] === "") {
		parts.pop();
	}
	return parts;
}

/**
 * Split newline-delimited output into non-empty lines.
 */
export function splitLines(output: string): string[] {
	if (output === "") return [];
	return output.split("\n").filter((line) => line !== "");
}

/**
 * Parse key-value output like "key value" separated by whitespace.
 */
export function parseKV(
	line: string,
	separator = /\s+/,
): { key: string; value: string } | null {
	const idx = line.search(separator);
	if (idx === -1) return null;
	const match = line.slice(idx).match(separator);
	if (!match) return null;
	return {
		key: line.slice(0, idx),
		value: line.slice(idx + match[0].length),
	};
}

/**
 * Parse a size string like "1234 kilobytes" → 1234 (number).
 */
export function parseSize(value: string): number {
	const num = Number.parseInt(value, 10);
	return Number.isNaN(num) ? 0 : num;
}

/**
 * Extract file extension from a path. Returns lowercase extension without dot,
 * or "(no ext)" for files with no extension.
 */
export function getExtension(filePath: string): string {
	const base = filePath.split("/").pop() ?? filePath;
	const dotIdx = base.lastIndexOf(".");
	if (dotIdx <= 0) return "(no ext)";
	return base.slice(dotIdx + 1).toLowerCase();
}

/**
 * Trim trailing whitespace/newlines from command output.
 */
export function trimOutput(output: string): string {
	return output.trimEnd();
}

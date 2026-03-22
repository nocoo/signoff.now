import type { GitInfoReport } from "../commands/types.ts";
import type { Section } from "./args.ts";

export function formatJson(
	report: GitInfoReport,
	section: Section | null,
): string {
	if (section) {
		return JSON.stringify(report[section]);
	}
	return JSON.stringify(report);
}

export function formatJsonPretty(
	report: GitInfoReport,
	section: Section | null,
): string {
	if (section) {
		return JSON.stringify(report[section], null, 2);
	}
	return JSON.stringify(report, null, 2);
}

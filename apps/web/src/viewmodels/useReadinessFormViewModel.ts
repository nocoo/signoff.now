import {
	type Project,
	type PullRequest,
	projectMergeRequirements,
	projectReadinessRules,
	type ReadinessRule,
	readinessRulesSchema,
} from "@signoff/domain/workbench";
import { useState } from "react";

export function useReadinessFormViewModel(
	project: Project,
	pulls: PullRequest[],
	onSave: (rules: ReadinessRule[]) => Promise<boolean>,
) {
	const requirements = projectMergeRequirements(project, pulls);
	const [rules, setRules] = useState(() =>
		projectReadinessRules(project, pulls),
	);
	const [error, setError] = useState<string | null>(null);
	function update(next: ReadinessRule[]) {
		setRules(next);
		setError(null);
	}
	return {
		rules,
		requirements,
		error,
		moveRule: (key: string, index: number) => {
			const from = rules.findIndex((rule) => rule.gateId === key);
			if (from < 0 || index < 0 || index >= rules.length) return;
			const next = [...rules];
			next.splice(index, 0, ...next.splice(from, 1));
			update(next);
		},
		updateRule: (key: string, next: ReadinessRule) =>
			update(
				rules.map((rule) =>
					rule.gateId === key ? { ...next, gateId: key } : rule,
				),
			),
		reset: () =>
			update(projectReadinessRules({ ...project, readinessRules: [] }, pulls)),
		submit: async () => {
			const parsed = readinessRulesSchema.safeParse(rules);
			if (!parsed.success) {
				setError(parsed.error.issues.map((issue) => issue.message).join(". "));
				return false;
			}
			setError(null);
			return onSave(parsed.data);
		},
	};
}

import {
	DEFAULT_READINESS_RULES,
	type Project,
	type PullRequest,
	projectReadinessRules,
	type ReadinessRule,
	readinessRuleKey,
	readinessRulesSchema,
} from "@signoff/domain/workbench";
import { useState } from "react";

export function useReadinessFormViewModel(
	project: Project,
	pulls: PullRequest[],
	onSave: (rules: ReadinessRule[]) => Promise<boolean>,
) {
	const [rules, setRules] = useState(() => [...projectReadinessRules(project)]);
	const [error, setError] = useState<string | null>(null);
	const policyNames = new Map<string, string>();
	for (const pull of pulls.filter((item) => item.projectId === project.id)) {
		for (const policy of pull.policies.filter((item) => item.required)) {
			const key = policy.name.trim().toLowerCase();
			if (!policyNames.has(key)) policyNames.set(key, policy.name.trim());
		}
	}
	const keys = new Set(rules.map(readinessRuleKey));
	const policyOptions = [...policyNames.values()]
		.filter((name) => !keys.has(`policy:${name.toLowerCase()}`))
		.sort((a, b) => a.localeCompare(b));
	function update(next: ReadinessRule[]) {
		setRules(next);
		setError(null);
	}
	return {
		rules,
		error,
		policyOptions,
		moveRule: (key: string, index: number) => {
			const from = rules.findIndex((rule) => readinessRuleKey(rule) === key);
			if (from < 0 || index < 0 || index >= rules.length) return;
			const next = [...rules];
			next.splice(index, 0, ...next.splice(from, 1));
			update(next);
		},
		updateRule: (key: string, next: ReadinessRule) =>
			update(
				rules.map((rule) => (readinessRuleKey(rule) === key ? next : rule)),
			),
		addPolicy: (policy: string) => {
			if (!policyOptions.includes(policy) || rules.length >= 50) return;
			const next = [...rules];
			next.splice(
				rules.findIndex((rule) => "kind" in rule && rule.kind === "blocked"),
				0,
				{ policy, label: policy, color: "yellow" },
			);
			update(next);
		},
		removePolicy: (key: string) =>
			update(
				rules.filter(
					(rule) => "kind" in rule || readinessRuleKey(rule) !== key,
				),
			),
		reset: () => update([...DEFAULT_READINESS_RULES]),
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

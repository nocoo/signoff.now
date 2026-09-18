import {
	basePullReadiness,
	basePullRequirements,
	type CheckState,
	type MachineCondition,
	type Project,
	type PullReadiness,
	type PullRequest,
	policyKind,
	projectMergeRequirements,
	projectReadinessRules,
	pullProgress,
	READINESS_LABELS,
	type ReadinessKind,
	readinessColor,
	type StateMachine,
} from "./workbench.js";

/** Provider vocabulary translation, not a readiness decision. */
export function providerCheckState(raw: string | null | undefined): CheckState {
	switch (raw?.toLowerCase()) {
		case "approved":
		case "succeeded":
		case "success":
			return "passed";
		case "notapplicable":
		case "skipped":
			return "skipped";
		case "failed":
		case "failure":
		case "error":
		case "rejected":
		case "broken":
		case "partiallysucceeded":
			return "failed";
		case "running":
		case "inprogress":
		case "cancelling":
			return "running";
		case "queued":
		case "notstarted":
			return "queued";
		case "waiting":
		case "pending":
			return "waiting";
		case "canceled":
		case "cancelled":
			return "canceled";
		default:
			return "unknown";
	}
}

/** Interpret retained evidence without mutating the provider snapshot. Old snapshots remain readable. */
export function interpretPull(pr: PullRequest): PullRequest {
	const policies = pr.policies.map((policy) => {
		const evidence = policy.evidence;
		if (!evidence) return policy;
		const expired =
			policyKind(policy) === "build" ? evidence.isExpired : undefined;
		const state = expired
			? "failed"
			: policy.id.startsWith("status-") &&
					evidence.status?.toLowerCase() === "pending"
				? "running"
				: providerCheckState(evidence.status);
		return {
			...policy,
			state,
			expired,
			required:
				evidence.isBlocking === undefined && evidence.isEnabled === undefined
					? policy.required
					: evidence.isBlocking !== false &&
						evidence.isEnabled !== false &&
						evidence.status?.toLowerCase() !== "notapplicable",
			detail: expired
				? `${policy.name} has expired. Queue a new build for the current PR and target branch.`
				: policy.detail,
		};
	});
	const reviewPolicies = policies.filter(
		(p) =>
			p.required &&
			p.evidence?.typeId?.toLowerCase() ===
				"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
	);
	const authorCountsTowardApproval = reviewPolicies.length
		? !reviewPolicies.some((p) => p.evidence?.creatorVoteCounts === false)
		: pr.authorCountsTowardApproval;
	return {
		...pr,
		policies,
		authorCountsTowardApproval,
		requiredApprovals: reviewPolicies.length
			? Math.max(
					0,
					...reviewPolicies.map((p) => p.evidence?.minimumApproverCount ?? 0),
				)
			: pr.requiredApprovals,
		allowDownvotes: reviewPolicies.length
			? reviewPolicies.every((p) => p.evidence?.allowDownvotes === true)
			: pr.allowDownvotes,
		reviewers: pr.reviewers.map((r) => ({
			...r,
			vote:
				r.providerVote === undefined
					? r.vote
					: r.providerVote >= 5
						? "approved"
						: r.providerVote < 0
							? "changes_requested"
							: "pending",
			countsTowardApproval: reviewPolicies.length
				? !r.isGroup &&
					(r.id !== pr.author.id || authorCountsTowardApproval !== false)
				: r.countsTowardApproval,
		})),
		builds: pr.builds.map((b) => ({
			...b,
			state: b.evidence
				? providerCheckState(b.evidence.result || b.evidence.status)
				: b.state,
			stages: b.stages.map((s) => ({
				...s,
				state: s.evidence
					? (s.evidence.result || s.evidence.status)?.toLowerCase() ===
						"pending"
						? "queued"
						: providerCheckState(s.evidence.result || s.evidence.status)
					: s.state,
			})),
		})),
	};
}

const gateGroups = {
	conflict: "Lifecycle",
	review: "Review",
	build: "Build",
	status: "Compliance",
	policy: "Compliance",
};
export function defaultStateMachine(
	project: Project,
	pulls: PullRequest[] = [],
): StateMachine {
	const requirements = projectMergeRequirements(project, pulls);
	return {
		states: (Object.keys(READINESS_LABELS) as ReadinessKind[]).map((kind) => ({
			id: kind,
			kind,
			label: READINESS_LABELS[kind],
			color: readinessColor({ kind }, { ...project, readinessRules: [] }),
			group: ["draft", "merged", "closed"].includes(kind)
				? "Lifecycle"
				: "Readiness",
		})),
		mappings: (Object.keys(READINESS_LABELS) as ReadinessKind[]).map(
			(kind) => ({
				id: `builtin:${kind}`,
				name: READINESS_LABELS[kind],
				stateId: kind,
				enabled: true,
				match: "all",
				conditions: [{ fact: "baseline", oneOf: [kind] }],
			}),
		),
		gates: projectReadinessRules(project, pulls).map((rule) => ({
			...rule,
			group:
				gateGroups[
					requirements.find((gate) => gate.id === rule.gateId)?.kind ?? "policy"
				],
		})),
	};
}

export function effectiveStateMachine(
	project: Project,
	repositoryId?: string,
	pulls: PullRequest[] = [],
) {
	const override = repositoryId
		? project.stateMachine?.repositories[repositoryId]
		: undefined;
	const saved = override ?? project.stateMachine?.default;
	const defaults = defaultStateMachine(
		{
			...project,
			mergeRequirements: project.mergeRequirements?.filter(
				(gate) =>
					!repositoryId ||
					!gate.scope?.length ||
					gate.scope.some(
						(scope) =>
							!scope.repositoryId ||
							scope.repositoryId.toLowerCase() === repositoryId.toLowerCase(),
					),
			),
		},
		pulls,
	);
	return {
		config: saved
			? {
					...saved,
					gates: [
						...saved.gates,
						...defaults.gates.filter(
							(gate) => !saved.gates.some((g) => g.gateId === gate.gateId),
						),
					],
				}
			: defaults,
		inherited: !override,
		configured: Boolean(saved),
		revision: project.stateMachineRevision ?? 1,
	};
}

export function checksValidity(pull: PullRequest) {
	return pull.checksInvalidated
		? "invalidated"
		: pull.checksObservedAt === null
			? "missing"
			: "valid";
}

export type MachineTrace = {
	ruleId: string;
	stateId: string;
	matched: boolean;
	selected: boolean;
	results: boolean[];
	guard?: string;
};

function matchesCondition(
	condition: MachineCondition,
	pull: PullRequest,
	base: PullReadiness,
	gates: ReturnType<typeof basePullRequirements>,
): boolean {
	switch (condition.fact) {
		case "lifecycle":
			return condition.oneOf.includes(pull.state);
		case "draft":
			return pull.draft === condition.equals;
		case "mergeable":
			return condition.oneOf.includes(pull.mergeable);
		case "coverage":
			return condition.oneOf.includes(pull.coverage);
		case "checksValidity":
			return condition.oneOf.includes(checksValidity(pull));
		case "baseline":
			return condition.oneOf.includes(base.kind);
		case "gate":
			return gates.some(
				(g) =>
					(g.id === condition.gateId ||
						g.sourceIds?.includes(condition.gateId)) &&
					condition.oneOf.includes(g.state),
			);
		default: {
			const gate = gates.find(
				(g) =>
					g.id === condition.gateId || g.sourceIds?.includes(condition.gateId),
			);
			const policies = pull.policies.filter(
				(p) => p.id === condition.gateId || gate?.sourceIds?.includes(p.id),
			);
			return policies.some((p) => {
				if (condition.fact === "policyStatus")
					return (
						p.evidence?.status !== undefined &&
						condition.oneOf.some(
							(v) => v.toLowerCase() === p.evidence?.status?.toLowerCase(),
						)
					);
				return (
					(condition.fact === "buildExpired"
						? (p.evidence?.isExpired ?? p.expired)
						: p.evidence?.buildIsNotCurrent) === condition.equals
				);
			});
		}
	}
}

function guardMapping(kind: ReadinessKind, base: PullReadiness) {
	if (["merged", "closed", "draft"].includes(base.kind) && kind !== base.kind)
		return "Provider lifecycle takes precedence";
	if (["merged", "closed", "draft"].includes(kind) && kind !== base.kind)
		return "A mapping cannot change provider lifecycle";
	if (kind === "ready" && base.kind !== "ready")
		return "All required checks and current evidence must pass before ready";
	return;
}

/** Stateless evaluation: identical facts + configuration always produce identical results. */
export function evaluatePull(snapshot: PullRequest, project: Project) {
	const pull = interpretPull(snapshot);
	const machine = effectiveStateMachine(project, pull.repository.id, [pull]);
	const effectiveProject = machine.configured
		? {
				...project,
				readinessRules: machine.config.gates.map(
					({ gateId, label, color }) => ({ gateId, label, color }),
				),
			}
		: project;
	const base = basePullReadiness(pull, effectiveProject);
	if (
		pull.state === "open" &&
		pull.evidence?.status &&
		!["active", "open"].includes(pull.evidence.status.toLowerCase())
	) {
		base.issues.push({
			kind: "unknown",
			label: "Unknown provider lifecycle",
			action: `Verify provider status: ${pull.evidence.status}`,
			owner: project.owner,
		});
		if (base.kind === "ready")
			Object.assign(base, base.issues[base.issues.length - 1]);
	}
	const requirements = basePullRequirements(pull, effectiveProject);
	let selected: StateMachine["mappings"][number] | undefined;
	const trace: MachineTrace[] = machine.config.mappings.map((rule) => {
		const results = rule.conditions.map((condition) =>
			matchesCondition(condition, pull, base, requirements),
		);
		const matched =
			rule.enabled &&
			(rule.match === "all" ? results.every(Boolean) : results.some(Boolean));
		const state = machine.config.states.find((s) => s.id === rule.stateId);
		const guard = matched && state ? guardMapping(state.kind, base) : undefined;
		const choose = matched && !guard && !selected && Boolean(state);
		if (choose) selected = rule;
		return {
			ruleId: rule.id,
			stateId: rule.stateId,
			results,
			matched,
			selected: choose,
			...(guard ? { guard } : {}),
		};
	});
	const state = machine.config.states.find((s) => s.id === selected?.stateId);
	const defaultLabel =
		selected?.id === `builtin:${base.kind}` &&
		state?.label === READINESS_LABELS[base.kind];
	const readiness: PullReadiness = {
		...base,
		kind: state?.kind ?? base.kind,
		label: defaultLabel ? base.label : (state?.label ?? base.label),
		color:
			defaultLabel &&
			state?.color === readinessColor({ kind: base.kind }, project)
				? (base.color ?? state.color)
				: (state?.color ?? base.color),
		stateId: state?.id ?? base.kind,
		machineRevision: machine.revision,
		matchedRuleId: selected?.id,
	};
	return {
		pull,
		readiness,
		requirements,
		progress: pullProgress(pull),
		trace,
		inherited: machine.inherited,
	};
}

export const evaluateReadiness = (pull: PullRequest, project: Project) =>
	evaluatePull(pull, project).readiness;
export const evaluateRequirements = (pull: PullRequest, project: Project) =>
	evaluatePull(pull, project).requirements;

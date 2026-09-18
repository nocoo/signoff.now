import { demoWorkspace } from "@signoff/domain/demo";
import { machinePageSchema } from "@signoff/domain/query";
import {
	defaultStateMachine,
	evaluatePull,
} from "@signoff/domain/state-machine";

export function machineFixture() {
	const workspace = demoWorkspace(1_800_000_000);
	const project = {
		...workspace.projects[0],
		source: "cli" as const,
		stateMachineRevision: 1,
	};
	const pull = { ...workspace.pullRequests[0], projectId: project.id };
	const result = evaluatePull(pull, project);
	return machinePageSchema.parse({
		project,
		repositoryId: pull.repository.id,
		repositories: [pull.repository],
		config: defaultStateMachine(project, [pull]),
		revision: 1,
		inherited: true,
		configured: false,
		dataRevision: "1",
		total: 1,
		evaluatedCount: 1,
		truncated: false,
		catalog: result.requirements,
		selectedPull: pull,
		evaluations: [
			{
				id: pull.id,
				number: pull.number,
				title: pull.title,
				repositoryId: pull.repository.id,
				lifecycle: pull.state,
				watched: true,
				summaryObservedAt: pull.observedAt,
				checksObservedAt: pull.observedAt,
				readiness: {
					...result.readiness,
					ready: result.readiness.kind === "ready",
					primaryRequirementId: result.readiness.gateId ?? null,
					nextAction: result.readiness.action,
				},
				requirements: result.requirements,
				trace: result.trace,
			},
		],
		history: [{ revision: 1, createdAt: 1_800_000_000 }],
		transitions: [],
	});
}

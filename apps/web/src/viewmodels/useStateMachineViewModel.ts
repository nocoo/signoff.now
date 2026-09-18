import type { MachinePage, MachinePreview } from "@signoff/domain/query";
import { effectiveStateMachine } from "@signoff/domain/state-machine";
import {
	type StateMachine,
	stateMachineSchema,
} from "@signoff/domain/workbench";
import { useEffect, useRef, useState } from "react";
import {
	loadMachine,
	loadMachineVersion,
	type MachineScope,
	previewMachine,
	saveMachine,
} from "@/models/stateMachineApi";
import { useQueryBlock } from "./useQueryBlock";

export function useStateMachineViewModel(
	scope: MachineScope,
	pullId: string | null,
) {
	const key = JSON.stringify(scope);
	const query = useQueryBlock(
		scope.projectId ? `${key}:${pullId}` : null,
		(signal) => loadMachine(scope, pullId, signal),
	);
	const retained = useRef<{ key: string; data: MachinePage } | null>(null);
	if (query.data) retained.current = { key, data: query.data };
	const cached =
		query.data ??
		(retained.current?.key === key ? retained.current.data : null);
	// Changing the traced PR keeps the canvas and draft mounted, but must not
	// show the previous PR's raw evidence or historical transitions.
	const data =
		cached && cached.selectedPull?.id !== pullId
			? { ...cached, selectedPull: null, transitions: [] }
			: cached;
	const [draft, setDraft] = useState<{
		key: string;
		revision: number;
		config: StateMachine | null;
	} | null>(null);
	const [preview, setPreview] = useState<{
		key: string;
		result: MachinePreview;
	} | null>(null);
	const [operation, setOperation] = useState<{
		key: string;
		name: string;
	} | null>(null);
	const [feedback, setFeedback] = useState<{
		key: string;
		error?: string;
		notice?: string;
	} | null>(null);
	const generation = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scope changes fence pending preview/save responses
	useEffect(
		() => () => {
			generation.current++;
		},
		[key],
	);
	const activeDraft = draft?.key === key ? draft : null;
	const dirty = Boolean(activeDraft);
	const busy = operation?.key === key ? operation.name : null;
	const currentPreview = preview?.key === key ? preview.result : null;
	const conflict = Boolean(
		activeDraft && data && activeDraft.revision !== data.revision,
	);
	const config = activeDraft
		? (activeDraft.config ??
			(data
				? effectiveStateMachine(
						{
							...data.project,
							mergeRequirements: data.catalog,
							stateMachine: {
								default: scope.repositoryId
									? (data.project.stateMachine?.default ?? null)
									: null,
								repositories: {},
							},
						},
						scope.repositoryId ?? undefined,
					).config
				: null))
		: (data?.config ?? null);
	const canSave = dirty && Boolean(currentPreview) && !conflict && !busy;
	function update(next: StateMachine | null) {
		if (!data) return;
		generation.current++;
		setDraft({
			key,
			revision: activeDraft?.revision ?? data.revision,
			config: next,
		});
		setPreview(null);
		setFeedback(null);
		setOperation(null);
	}
	function discard() {
		generation.current++;
		setDraft(null);
		setPreview(null);
		setFeedback(null);
		setOperation(null);
	}
	async function run(
		name: string,
		work: (current: () => boolean) => Promise<void>,
	) {
		if (!data || busy) return;
		const token = ++generation.current;
		const current = () => token === generation.current;
		setOperation({ key, name });
		setFeedback(null);
		try {
			await work(current);
		} catch (error) {
			if (current())
				setFeedback({
					key,
					error:
						error instanceof Error
							? error.message
							: "Unable to update state machine",
				});
		} finally {
			if (current()) setOperation(null);
		}
	}
	return {
		...query,
		data,
		config,
		dirty,
		busy,
		conflict,
		canSave,
		preview: currentPreview,
		error:
			feedback?.key === key ? (feedback.error ?? query.error) : query.error,
		notice: feedback?.key === key ? feedback.notice : undefined,
		update,
		discard,
		rebase: () => {
			if (activeDraft && data) {
				generation.current++;
				setDraft({ ...activeDraft, revision: data.revision });
				setPreview(null);
				setFeedback(null);
				setOperation(null);
			}
		},
		previewDraft: () =>
			run("preview", async (current) => {
				if (!activeDraft || conflict) return;
				const validated =
					activeDraft.config === null
						? null
						: stateMachineSchema.parse(activeDraft.config);
				const result = await previewMachine(
					scope,
					{
						revision: activeDraft.revision,
						repositoryId: scope.repositoryId,
						config: validated,
					},
					pullId,
				);
				if (current()) setPreview({ key, result });
			}),
		save: () =>
			run("save", async (current) => {
				if (!canSave || !activeDraft) return;
				const result = await saveMachine(scope, {
					revision: activeDraft.revision,
					repositoryId: scope.repositoryId,
					config: activeDraft.config,
				});
				if (current()) {
					discard();
					setFeedback({
						key,
						notice: `Saved revision ${result.revision}. Cached PRs now use these rules.`,
					});
					await query.reload();
				}
			}),
		restore: (revision: number) =>
			run("restore", async (current) => {
				const result = await loadMachineVersion(scope, revision);
				if (current()) {
					setDraft({ key, revision: result.revision, config: result.config });
					setPreview(null);
					setFeedback({
						key,
						notice: `Revision ${revision} loaded as a draft. Preview before saving.`,
					});
				}
			}),
	};
}
export type StateMachineViewModel = ReturnType<typeof useStateMachineViewModel>;

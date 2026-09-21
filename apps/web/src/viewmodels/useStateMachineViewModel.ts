import type { MachinePage } from "@signoff/domain/query";
import { useState } from "react";
import {
	loadMachine,
	type MachineScope,
	saveMachine,
} from "@/models/stateMachineApi";
import { useQueryBlock } from "./useQueryBlock";
export function useStateMachineViewModel(scope: MachineScope) {
	const query = useQueryBlock(
		scope.projectId ? JSON.stringify(scope) : null,
		(signal) => loadMachine(scope, signal),
		0,
	);
	const [draft, setDraft] = useState<{
		revision: number;
		instructions: MachinePage["instructions"];
	} | null>(null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null),
		[notice, setNotice] = useState<string | null>(null);
	const instructions = draft?.instructions ?? query.data?.instructions ?? [];
	const update = (items: MachinePage["instructions"]) => {
		if (query.data)
			setDraft({
				revision: draft?.revision ?? query.data.revision,
				instructions: items,
			});
	};
	const describe = (id: string, description: string) =>
		update(
			instructions.map((i) => (i.gateId === id ? { ...i, description } : i)),
		);
	const move = (index: number, direction: number) => {
		const to = index + direction;
		if (to < 0 || to >= instructions.length) return;
		const items = [...instructions];
		const current = items[index],
			target = items[to];
		if (!current || !target) return;
		[items[index], items[to]] = [target, current];
		update(items);
	};
	const save = async (inherit = false) => {
		if (!query.data || busy) return;
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const saved = await saveMachine(scope, {
				revision: draft?.revision ?? query.data.revision,
				repositoryId: scope.repositoryId,
				instructions: inherit ? null : instructions,
			});
			query.update(() => saved);
			setDraft(null);
			setNotice(
				"Policy instructions saved. Affected watched PRs will be reevaluated.",
			);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Unable to save policy instructions.",
			);
		} finally {
			setBusy(false);
		}
	};
	return {
		query,
		instructions,
		dirty: Boolean(draft),
		busy,
		error,
		notice,
		describe,
		move,
		save,
		discard: () => setDraft(null),
	};
}

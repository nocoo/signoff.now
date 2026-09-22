import type { MachinePullOption } from "@signoff/domain/query";
import { useEffect, useRef, useState } from "react";
import { loadMachinePulls, type MachineScope } from "@/models/stateMachineApi";

type PickerState = {
	key: string;
	items: MachinePullOption[];
	nextCursor: string | null;
	loading: boolean;
	error: string | null;
};
export function useMachinePullPicker(
	scope: MachineScope,
	search: string,
	watchedOnly: boolean,
) {
	const key = JSON.stringify([
		scope.source,
		scope.projectId,
		scope.repositoryId,
		search,
		watchedOnly,
	]);
	const [state, setState] = useState<PickerState | null>(null);
	const execute = useRef<(reset: boolean) => Promise<void>>(() =>
		Promise.resolve(),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the primitive key includes every query input
	useEffect(() => {
		let active = true;
		let pending = false;
		let loaded = false;
		let items: MachinePullOption[] = [];
		let cursor: string | null = null;
		let controller: AbortController | null = null;
		let timer: ReturnType<typeof setTimeout>;
		const run = async (reset: boolean) => {
			if (
				!active ||
				pending ||
				!scope.projectId ||
				(!reset && loaded && !cursor)
			)
				return;
			clearTimeout(timer);
			if (reset) {
				items = [];
				cursor = null;
				loaded = false;
			}
			pending = true;
			controller = new AbortController();
			const signal = controller.signal;
			setState({ key, items, nextCursor: cursor, loading: true, error: null });
			try {
				const page = await loadMachinePulls(
					scope,
					{ search, watchedOnly, cursor },
					signal,
				);
				if (!active || signal.aborted) return;
				items = [
					...new Map(
						[...items, ...page.data].map((pr) => [pr.id, pr]),
					).values(),
				];
				cursor = page.nextCursor;
				loaded = true;
				setState({
					key,
					items,
					nextCursor: cursor,
					loading: false,
					error: null,
				});
			} catch (error) {
				if (active && !signal.aborted)
					setState({
						key,
						items,
						nextCursor: cursor,
						loading: false,
						error:
							error instanceof Error ? error.message : "Unable to load PRs",
					});
			} finally {
				pending = false;
			}
		};
		execute.current = run;
		timer = setTimeout(() => void run(false), search ? 200 : 0);
		return () => {
			active = false;
			clearTimeout(timer);
			controller?.abort();
		};
	}, [key]);
	const current = state?.key === key ? state : null;
	return {
		items: current?.items ?? [],
		loading: Boolean(scope.projectId) && (current?.loading ?? true),
		error: current?.error ?? null,
		hasMore: Boolean(current?.nextCursor),
		loadMore: () => execute.current(false),
		reload: () => execute.current(true),
	};
}

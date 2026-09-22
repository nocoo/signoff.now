import type { DataSource } from "@signoff/domain/monitoring";
import { useEffect, useRef, useState } from "react";
import { pullQueryParams, queryRow } from "@/models/monitoringApi";
import {
	loadCollectionPulls,
	loadCollections,
	loadMemberships,
} from "@/models/prCollectionsApi";
import {
	DEFAULT_PULL_FILTER,
	type PullFilter,
	updatePullFilter,
} from "@/models/workbench";
import { useQueryBlock } from "./useQueryBlock";
import { useWorkbench } from "./WorkbenchProvider";

export function usePrCollections(source: DataSource) {
	return useQueryBlock(`collections:${source}`, (signal) =>
		loadCollections(source, signal),
	);
}
export function usePrMemberships(source: DataSource, ids: string[]) {
	return useQueryBlock(
		ids.length ? `memberships:${source}:${JSON.stringify(ids)}` : null,
		(signal) => loadMemberships(source, ids, signal),
	);
}
export function useCollectionMutation(onChange: () => Promise<unknown>) {
	const active = useRef(true),
		locked = useRef(false);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	async function run<T>(work: () => Promise<T>): Promise<T | null> {
		if (locked.current) return null;
		locked.current = true;
		setBusy(true);
		setError(null);
		try {
			const result = await work();
			if (!active.current) return null;
			await onChange();
			return active.current ? result : null;
		} catch (e) {
			if (active.current)
				setError(
					e instanceof Error ? e.message : "Could not update collection.",
				);
			return null;
		} finally {
			locked.current = false;
			if (active.current) setBusy(false);
		}
	}
	return { busy, error, run };
}
export function useCollectionSearch() {
	const [search, setSearch] = useState(""),
		[query, setQuery] = useState("");
	useEffect(() => {
		const timer = setTimeout(() => setQuery(search.trim()), 300);
		return () => clearTimeout(timer);
	}, [search]);
	return { search, setSearch, query };
}

export function useCollectionPullList(
	source: DataSource,
	collectionId: string,
) {
	const workbench = useWorkbench();
	const [filter, updateFilter] = useState<PullFilter>({
		...DEFAULT_PULL_FILTER,
		source,
		state: "all",
		draft: "include",
		sort: "updated",
		sortDirection: "desc",
	});
	const [selected, setSelected] = useState(new Set<string>());
	const search = useCollectionSearch();
	const params = new URLSearchParams(
		pullQueryParams({ ...filter, query: search.query }, 1),
	);
	params.set("collectionId", collectionId);
	const query = params.toString();
	const pulls = useQueryBlock(`collection-prs:${query}`, (signal) =>
		loadCollectionPulls(query, signal),
	);
	const rows =
		pulls.data?.data.map((item) => workbench.withWatchState(queryRow(item))) ??
		[];
	const selectedRows = rows.filter((row) => selected.has(row.pull.id));
	const selectedIds = new Set(selectedRows.map((row) => row.pull.id));
	return {
		pulls,
		rows,
		selectedRows,
		selectedIds,
		filter,
		setFilter: (patch: Partial<PullFilter>) => {
			updateFilter((current) => updatePullFilter(current, patch));
			if (patch.query !== undefined) search.setSearch(patch.query);
			setSelected(new Set());
		},
		authors: pulls.data?.authors ?? [],
		metrics: pulls.data?.metrics ?? workbench.metrics,
		pullsLoaded: pulls.data !== null,
		selectAll: (checked: boolean) =>
			setSelected(new Set(checked ? rows.map((row) => row.pull.id) : [])),
		toggleSelection: (id: string, checked: boolean) =>
			setSelected((current) => {
				const next = new Set(current);
				if (checked) next.add(id);
				else next.delete(id);
				return next;
			}),
	};
}

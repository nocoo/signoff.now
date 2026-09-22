import type { DataSource } from "@signoff/domain/monitoring";
import { useEffect, useRef, useState } from "react";
import { loadCollections, loadMemberships } from "@/models/prCollectionsApi";
import { useQueryBlock } from "./useQueryBlock";

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

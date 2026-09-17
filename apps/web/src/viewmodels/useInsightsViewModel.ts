import {
	type ContributionFilters,
	contributionFiltersSchema,
	type DataSource,
	type DirectoryData,
	defaultContributionFilters,
} from "@signoff/domain/insights";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDirectory } from "@/models/directoryApi";

type Page = "insights" | "repositories";
function defaults(source: DataSource, page: Page) {
	return page === "insights"
		? defaultContributionFilters(source)
		: contributionFiltersSchema.parse({ source });
}
function readFilters(
	key: string,
	source: DataSource,
	page: Page,
): ContributionFilters {
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
		if (saved === null || typeof saved !== "object" || Array.isArray(saved))
			return defaults(source, page);
		return contributionFiltersSchema.parse({
			...defaults(source, page),
			...saved,
			source,
		});
	} catch {
		return defaults(source, page);
	}
}

export function useInsightsViewModel(
	source: DataSource,
	page: Page = "insights",
) {
	const storageKey = `signoff-${page}-filters:${source}`;
	const initial = useMemo(
		() => readFilters(storageKey, source, page),
		[storageKey, source, page],
	);
	const [edits, setEdits] = useState<Record<string, ContributionFilters>>({});
	const filters = edits[storageKey] ?? initial;
	const parsed = useMemo(
		() => contributionFiltersSchema.safeParse(filters),
		[filters],
	);
	const setFilters = useCallback(
		(patch: Partial<Omit<ContributionFilters, "source">>) => {
			setEdits((previous) => {
				const next = { ...(previous[storageKey] ?? initial), ...patch, source };
				const valid = contributionFiltersSchema.safeParse(next);
				if (valid.success) {
					try {
						localStorage.setItem(storageKey, JSON.stringify(valid.data));
					} catch {
						/* In-memory filters still work. */
					}
				}
				return { ...previous, [storageKey]: next };
			});
		},
		[initial, source, storageKey],
	);
	const resetFilters = useCallback(
		() => setFilters(defaults(source, page)),
		[setFilters, source, page],
	);
	const [state, setState] = useState<{
		source: DataSource;
		data: DirectoryData | null;
		error: string | null;
		loading: boolean;
	}>({ source, data: null, error: null, loading: true });
	const sequence = useRef(0);
	const reloadDirectory = useCallback(async () => {
		const ticket = ++sequence.current;
		setState((previous) => ({
			source,
			data: previous.source === source ? previous.data : null,
			error: null,
			loading: true,
		}));
		try {
			const data = await fetchDirectory(source);
			if (sequence.current === ticket)
				setState({ source, data, error: null, loading: false });
		} catch (error) {
			if (sequence.current === ticket)
				setState({
					source,
					data: null,
					error:
						error instanceof Error ? error.message : "Could not load directory",
					loading: false,
				});
		}
	}, [source]);
	useEffect(() => {
		void reloadDirectory();
		return () => {
			++sequence.current;
		};
	}, [reloadDirectory]);
	return {
		filters,
		setFilters,
		resetFilters,
		validFilters: parsed.success ? parsed.data : null,
		filterError: parsed.success
			? null
			: (parsed.error.issues[0]?.message ?? "Invalid filters"),
		directory: state.source === source ? state.data : null,
		error: state.source === source ? state.error : null,
		loading: state.source !== source || state.loading,
		reloadDirectory,
	};
}

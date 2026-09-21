import type { JobHistoryFilters } from "@signoff/domain/query";
import { useState } from "react";
import {
	loadCollectionJob,
	loadCollectorHistory,
} from "@/models/monitoringApi";
import type { PullFilter } from "@/models/workbench";
import { useQueryBlock } from "./useQueryBlock";

export function useCollectorHistoryViewModel(source: PullFilter["source"]) {
	const [filters, setFilters] = useState<JobHistoryFilters>({
		lane: "all",
		outcome: "all",
	});
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const cursor = cursors[cursors.length - 1];
	const history = useQueryBlock(
		`history:${source}:${JSON.stringify(filters)}:${cursor ?? ""}`,
		(signal) => loadCollectorHistory(source, { ...filters, cursor }, signal),
		cursor ? 0 : 15000,
	);
	const detail = useQueryBlock(
		selectedId ? `job:${source}:${selectedId}` : null,
		(signal) => loadCollectionJob(source, selectedId ?? "", signal),
		3000,
	);
	return {
		history,
		detail,
		filters,
		selectedId,
		select: setSelectedId,
		page: cursors.length,
		setFilters: (next: JobHistoryFilters) => {
			setFilters(next);
			setCursors([undefined]);
			setSelectedId(null);
		},
		older: () => {
			if (history.data?.nextCursor) {
				setCursors([...cursors, history.data.nextCursor]);
				setSelectedId(null);
			}
		},
		newer: () => {
			setCursors(cursors.slice(0, -1));
			setSelectedId(null);
		},
	};
}

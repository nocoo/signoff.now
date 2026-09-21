import { useEffect, useState } from "react";
import { loadCollectorGroups } from "@/models/monitoringApi";
import type { PullFilter } from "@/models/workbench";
import { useQueryBlock } from "./useQueryBlock";

export function useCollectorGroupsViewModel(source: PullFilter["source"]) {
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const [selected, setSelected] = useState<string | null>(null);
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
	useEffect(() => {
		const timer = setInterval(
			() => setNow(Math.floor(Date.now() / 1000)),
			1000,
		);
		return () => clearInterval(timer);
	}, []);
	const cursor = cursors[cursors.length - 1];
	const groups = useQueryBlock(
		`collector-groups:${source}:${cursor ?? ""}`,
		(signal) => loadCollectorGroups(source, cursor, signal),
		3000,
	);
	return {
		groups,
		now,
		selected,
		select: (id: string) =>
			setSelected((current) => (current === id ? null : id)),
		page: cursors.length,
		older: () => {
			if (groups.data?.nextCursor) {
				setCursors([...cursors, groups.data.nextCursor]);
				setSelected(null);
			}
		},
		newer: () => {
			if (cursors.length > 1) {
				setCursors(cursors.slice(0, -1));
				setSelected(null);
			}
		},
	};
}

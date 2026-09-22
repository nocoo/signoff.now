import type { DataSource } from "@signoff/domain/monitoring";
import {
	DEFAULT_PULL_FILTER,
	PULL_FILTER_STORAGE_KEY,
	type PullFilter,
	readPullFilter,
	writePullFilter,
} from "./workbench";

const storageKey = (source: DataSource, id: string) =>
	`${PULL_FILTER_STORAGE_KEY}:collection:${source}:${id}`;

export function readCollectionFilters(
	source: DataSource,
	id: string,
): PullFilter {
	const defaults: PullFilter = {
		...DEFAULT_PULL_FILTER,
		source,
		state: "all",
		draft: "include",
		sort: "updated",
		sortDirection: "desc",
	};
	try {
		const saved = localStorage.getItem(storageKey(source, id));
		if (saved !== null)
			return {
				...readPullFilter(new URLSearchParams(saved)),
				source,
				organization: "",
				projectId: "",
				repository: "",
			};
	} catch {
		return defaults;
	}
	return defaults;
}

export function saveCollectionFilters(
	source: DataSource,
	id: string,
	filter: PullFilter,
) {
	try {
		localStorage.setItem(
			storageKey(source, id),
			writePullFilter(filter).toString(),
		);
	} catch {
		return;
	}
}

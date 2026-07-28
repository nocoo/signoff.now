import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Developer, DeveloperFilter, Team } from "@/models/entities";
import {
	EMPTY_DEVELOPER_FILTER,
	filterDevelopers,
	validateDeveloperInput,
} from "@/models/entities";
import {
	archiveDeveloper,
	createDeveloper,
	listDevelopers,
	listTeams,
	patchDeveloper,
	restoreDeveloper,
} from "@/models/entitiesApi";

export type DeveloperDraft = {
	name: string;
	alias: string;
	avatarUrl: string;
	teamIds: string[];
};

/**
 * Everything the Developers page does that is not rendering.
 *
 * It lives here rather than in the View because Views are excluded from the
 * coverage gate (03 §4.1) — loading, filtering, create/edit/archive
 * orchestration and error handling are exactly the parts whose being wrong is
 * invisible, so they have to sit where tests can reach them.
 */
export function useDevelopersViewModel() {
	const [items, setItems] = useState<Developer[]>([]);
	const [teams, setTeams] = useState<Team[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState<DeveloperFilter>(EMPTY_DEVELOPER_FILTER);
	const [editing, setEditing] = useState<Developer | null>(null);

	// Every reload takes a ticket; only the newest one may publish. Without
	// this a slow initial GET can land after a post-mutation reload and put the
	// pre-mutation roster back on screen — the change looks like it was lost.
	const ticket = useRef(0);

	const reload = useCallback(async () => {
		const mine = ++ticket.current;
		// allSettled, not all: the team list only decorates the roster and fills
		// one filter. Letting it reject would throw away developers that loaded
		// fine and leave the page empty — the one screen where the roster is the
		// entire point. Archived rows are always fetched and hidden by the
		// filter, so switching status needs no round trip.
		const [devs, tms] = await Promise.allSettled([
			listDevelopers(true),
			listTeams(),
		]);
		if (mine !== ticket.current) {
			return;
		}
		if (devs.status === "fulfilled") {
			setItems(devs.value);
		}
		if (tms.status === "fulfilled") {
			setTeams(tms.value);
		}
		const failed = [devs, tms].find((r) => r.status === "rejected");
		setError(
			failed === undefined
				? null
				: failed.reason instanceof Error
					? failed.reason.message
					: "Load failed",
		);
		setLoading(false);
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const visible = useMemo(
		() => filterDevelopers(items, filter),
		[items, filter],
	);
	const teamsById = useMemo(
		() => new Map(teams.map((t) => [t.id, t])),
		[teams],
	);

	/**
	 * One mutation at a time. A double-clicked Archive would otherwise fire two
	 * writes and surface the second one's error after the first had already
	 * succeeded — an error message for an action that worked.
	 */
	const mutate = useCallback(
		async (run: () => Promise<unknown>) => {
			if (busy) {
				return false;
			}
			setBusy(true);
			try {
				await run();
				await reload();
				return true;
			} catch (e) {
				setError(e instanceof Error ? e.message : "Request failed");
				return false;
			} finally {
				setBusy(false);
			}
		},
		[busy, reload],
	);

	const create = useCallback(
		async (name: string, alias: string) => {
			const invalid = validateDeveloperInput(name, alias);
			if (invalid) {
				setError(invalid);
				return false;
			}
			return mutate(() => createDeveloper(name, alias));
		},
		[mutate],
	);

	const submitEdit = useCallback(
		async (draft: DeveloperDraft) => {
			if (!editing) {
				return;
			}
			// Throws on failure so the dialog can keep itself open and show why;
			// swallowing here would close it and drop the user's edits.
			await patchDeveloper(editing.id, {
				name: draft.name,
				alias: draft.alias,
				// A blank field means "no avatar", which the API spells as null.
				avatarUrl: draft.avatarUrl.trim() || null,
				teamIds: draft.teamIds,
			});
			await reload();
		},
		[editing, reload],
	);

	return {
		items,
		teams,
		teamsById,
		visible,
		filter,
		setFilter,
		loading,
		busy,
		error,
		editing,
		setEditing,
		reload,
		create,
		submitEdit,
		archive: (id: string) => mutate(() => archiveDeveloper(id)),
		restore: (id: string) => mutate(() => restoreDeveloper(id)),
	};
}

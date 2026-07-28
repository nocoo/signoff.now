import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { avatarColor } from "@/lib/avatar";
import type { Developer, DeveloperFilter, Tag, Team } from "@/models/entities";
import { EMPTY_DEVELOPER_FILTER, filterDevelopers } from "@/models/entities";
import {
	archiveDeveloper,
	createDeveloper,
	createTag,
	listDevelopers,
	listTags,
	listTeams,
	patchDeveloper,
	restoreDeveloper,
} from "@/models/entitiesApi";

export type DeveloperDraft = {
	name: string;
	alias: string;
	avatarUrl: string;
	teamIds: string[];
	tagIds: string[];
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
	const [tags, setTags] = useState<Tag[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState<DeveloperFilter>(EMPTY_DEVELOPER_FILTER);
	const [editing, setEditing] = useState<Developer | null>(null);
	// `null` closes the dialog; a Developer edits it; "new" opens it empty.
	const [creating, setCreating] = useState(false);

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
		const [devs, tms, tgs] = await Promise.allSettled([
			listDevelopers(true),
			listTeams(),
			listTags(),
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
		if (tgs.status === "fulfilled") {
			setTags(tgs.value);
		}
		const failed = [devs, tms, tgs].find((r) => r.status === "rejected");
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
	const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

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

	/**
	 * Create and edit share one path: the dialog produces the same draft either
	 * way, and both must throw on failure so it can stay open and explain
	 * itself rather than close and drop the user's work.
	 */
	const submit = useCallback(
		async (draft: DeveloperDraft) => {
			const body = {
				name: draft.name,
				alias: draft.alias,
				// A blank field means "no avatar", which the API spells as null.
				avatarUrl: draft.avatarUrl.trim() || null,
				teamIds: draft.teamIds,
				tagIds: draft.tagIds,
			};
			if (editing) {
				await patchDeveloper(editing.id, body);
			} else {
				await createDeveloper(draft.name, draft.alias, {
					avatarUrl: body.avatarUrl,
					teamIds: body.teamIds,
					tagIds: body.tagIds,
				});
			}
			await reload();
		},
		[editing, reload],
	);

	/**
	 * Create a tag and hand back its id, so the dialog can select it without a
	 * round trip through the roster reload.
	 */
	const addTag = useCallback(async (name: string) => {
		const tag = await createTag(name, avatarColor(name));
		setTags((prev) =>
			[...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
		);
		return tag.id;
	}, []);

	return {
		items,
		teams,
		tags,
		teamsById,
		tagsById,
		visible,
		filter,
		setFilter,
		loading,
		busy,
		error,
		editing,
		setEditing,
		creating,
		setCreating,
		dialogOpen: creating || editing !== null,
		closeDialog: () => {
			setCreating(false);
			setEditing(null);
		},
		reload,
		submit,
		addTag,
		archive: (id: string) => mutate(() => archiveDeveloper(id)),
		restore: (id: string) => mutate(() => restoreDeveloper(id)),
	};
}

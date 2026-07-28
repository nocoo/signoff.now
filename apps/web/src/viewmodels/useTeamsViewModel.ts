import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { avatarColorHex } from "@/lib/avatar";
import type { Tag, Team, TeamFilter } from "@/models/entities";
import {
	EMPTY_TEAM_FILTER,
	filterTeams,
	validateAvatarUrl,
} from "@/models/entities";
import {
	archiveTeam,
	createTag,
	createTeam,
	listTags,
	listTeams,
	patchTeam,
	restoreTeam,
} from "@/models/entitiesApi";

export type TeamDraft = { name: string; avatarUrl: string; tagIds: string[] };

export function teamDraftFrom(team: Team | null): TeamDraft {
	return {
		name: team?.name ?? "",
		avatarUrl: team?.avatarUrl ?? "",
		tagIds: team?.tagIds ?? [],
	};
}

export function validateTeamDraft(draft: TeamDraft): string | null {
	if (!draft.name.trim()) {
		return "Name is required";
	}
	return validateAvatarUrl(draft.avatarUrl);
}

/** Loading, filtering, create/edit and archival for the Teams page. */
export function useTeamsViewModel() {
	const [items, setItems] = useState<Team[]>([]);
	const [tags, setTags] = useState<Tag[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState<TeamFilter>(EMPTY_TEAM_FILTER);
	const [editing, setEditing] = useState<Team | null>(null);
	// `creating` opens the dialog empty; `editing` opens it on a row.
	const [creating, setCreating] = useState(false);
	const ticket = useRef(0);

	const reload = useCallback(async () => {
		// Only the newest load may publish; a slow first fetch must not land on
		// top of a post-mutation refresh and undo it on screen.
		const mine = ++ticket.current;
		try {
			// Archived rows are always fetched and hidden by the filter, so
			// switching status needs no round trip.
			const [next, nextTags] = await Promise.all([listTeams(true), listTags()]);
			if (mine === ticket.current) {
				setItems(next);
				setTags(nextTags);
				setError(null);
			}
		} catch (e) {
			if (mine === ticket.current) {
				setError(e instanceof Error ? e.message : "Load failed");
			}
		} finally {
			if (mine === ticket.current) {
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const visible = useMemo(() => filterTeams(items, filter), [items, filter]);
	const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

	const mutate = useCallback(
		async (run: () => Promise<unknown>) => {
			// One write at a time: a double-clicked Archive would otherwise fire
			// two writes and surface the second one's error after the first had
			// already succeeded.
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
	 * way, and both must throw on failure so it can stay open and explain itself
	 * rather than close and drop the user's work.
	 */
	const submit = useCallback(
		async (draft: TeamDraft) => {
			const body = {
				name: draft.name.trim(),
				// A blank field means "no avatar", which the API spells as null.
				avatarUrl: draft.avatarUrl.trim() || null,
				tagIds: draft.tagIds,
			};
			if (editing) {
				await patchTeam(editing.id, body);
			} else {
				await createTeam(body.name, {
					avatarUrl: body.avatarUrl,
					tagIds: body.tagIds,
				});
			}
			await reload();
		},
		[editing, reload],
	);

	const addTag = useCallback(async (tagName: string) => {
		const tag = await createTag(tagName, avatarColorHex(tagName));
		setTags((prev) =>
			[...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
		);
		return tag.id;
	}, []);

	return {
		items,
		tags,
		tagsById,
		visible,
		filter,
		setFilter,
		addTag,
		error,
		loading,
		busy,
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
		archive: (id: string) => mutate(() => archiveTeam(id)),
		restore: (id: string) => mutate(() => restoreTeam(id)),
	};
}

/** Draft state for the team edit dialog; mirrors the developer one. */
export function useTeamEditViewModel(
	team: Team | null,
	onSubmit: (draft: TeamDraft) => Promise<void>,
	onDone: () => void,
) {
	const [draft, setDraft] = useState<TeamDraft>(() => teamDraftFrom(team));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// See useDeveloperEditViewModel: reset during render on an identity change,
	// so the new row is correct on first paint.
	const lastId = useRef<string | null>(team?.id ?? null);
	const editingId = team?.id ?? null;
	if (lastId.current !== editingId) {
		lastId.current = editingId;
		setDraft(teamDraftFrom(team));
		setError(null);
		setBusy(false);
	}

	const setField = useCallback(
		<K extends keyof TeamDraft>(key: K, value: TeamDraft[K]) =>
			setDraft((d) => ({ ...d, [key]: value })),
		[],
	);

	const toggleTag = useCallback(
		(id: string) =>
			setDraft((d) => ({
				...d,
				tagIds: d.tagIds.includes(id)
					? d.tagIds.filter((t) => t !== id)
					: [...d.tagIds, id],
			})),
		[],
	);

	/** Select a just-created tag without toggling it off by mistake. */
	const selectTag = useCallback(
		(id: string) =>
			setDraft((d) =>
				d.tagIds.includes(id) ? d : { ...d, tagIds: [...d.tagIds, id] },
			),
		[],
	);

	const save = useCallback(async () => {
		if (busy) {
			return false;
		}
		const invalid = validateTeamDraft(draft);
		if (invalid) {
			setError(invalid);
			return false;
		}
		setBusy(true);
		try {
			await onSubmit(draft);
			onDone();
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed");
			return false;
		} finally {
			setBusy(false);
		}
	}, [busy, draft, onSubmit, onDone]);

	return { draft, setField, toggleTag, selectTag, error, busy, save };
}

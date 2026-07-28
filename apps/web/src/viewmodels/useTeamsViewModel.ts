import { useCallback, useEffect, useRef, useState } from "react";
import type { Team } from "@/models/entities";
import { validateAvatarUrl } from "@/models/entities";
import {
	archiveTeam,
	createTeam,
	listTeams,
	patchTeam,
} from "@/models/entitiesApi";

export type TeamDraft = { name: string; avatarUrl: string };

export function teamDraftFrom(team: Team | null): TeamDraft {
	return { name: team?.name ?? "", avatarUrl: team?.avatarUrl ?? "" };
}

export function validateTeamDraft(draft: TeamDraft): string | null {
	if (!draft.name.trim()) {
		return "Name is required";
	}
	return validateAvatarUrl(draft.avatarUrl);
}

/** Loading, creation and archival for the Teams page. */
export function useTeamsViewModel() {
	const [items, setItems] = useState<Team[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<Team | null>(null);
	const ticket = useRef(0);

	const reload = useCallback(async () => {
		// Only the newest load may publish; a slow first fetch must not land on
		// top of a post-mutation refresh and undo it on screen.
		const mine = ++ticket.current;
		try {
			const next = await listTeams();
			if (mine === ticket.current) {
				setItems(next);
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

	const mutate = useCallback(
		async (run: () => Promise<unknown>) => {
			// One write at a time: the page offers create on both Enter and a
			// button, so the same submission can otherwise fire twice.
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

	const create = useCallback(async () => {
		if (!name.trim()) {
			setError("Name is required");
			return false;
		}
		const ok = await mutate(() => createTeam(name.trim()));
		if (ok) {
			setName("");
		}
		return ok;
	}, [mutate, name]);

	const submitEdit = useCallback(
		async (draft: TeamDraft) => {
			if (!editing) {
				return;
			}
			await patchTeam(editing.id, {
				name: draft.name,
				avatarUrl: draft.avatarUrl.trim() || null,
			});
			await reload();
		},
		[editing, reload],
	);

	return {
		items,
		name,
		setName,
		error,
		loading,
		busy,
		editing,
		setEditing,
		reload,
		create,
		submitEdit,
		archive: (id: string) => mutate(() => archiveTeam(id)),
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

	return { draft, setField, error, busy, save };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Repo, RepoFilter } from "@/models/entities";
import { EMPTY_REPO_FILTER, filterRepos } from "@/models/entities";
import {
	archiveRepo,
	createRepo,
	listRepos,
	patchRepo,
	restoreRepo,
} from "@/models/entitiesApi";

export type RepoDraft = {
	provider: string;
	org: string;
	project: string;
	name: string;
	externalId: string;
	projectExternalId: string;
	enabled: boolean;
};

export function repoDraftFrom(repo: Repo | null): RepoDraft {
	return {
		provider: repo?.provider ?? "ado",
		org: repo?.org ?? "",
		project: repo?.project ?? "",
		name: repo?.name ?? "",
		externalId: repo?.externalId ?? "",
		projectExternalId: repo?.projectExternalId ?? "",
		enabled: repo?.enabled ?? true,
	};
}

/**
 * Reject what the server would, next to the field rather than as a failed save.
 *
 * The externalId rule is the server's own (`parseRepoBody`): an enabled ADO
 * binding without a repository GUID cannot be collected, so it is refused on
 * write. Letting it through here turns a missing field into a 400.
 */
export function validateRepoDraft(draft: RepoDraft): string | null {
	if (!draft.org.trim()) {
		return "Org is required";
	}
	if (!draft.project.trim()) {
		return "Project is required";
	}
	if (!draft.name.trim()) {
		return "Repo name is required";
	}
	if (draft.provider === "ado" && draft.enabled && !draft.externalId.trim()) {
		return "An enabled ADO repo needs its repository GUID";
	}
	return null;
}

/** Loading, filtering, create/edit and archival for the Repos page. */
export function useReposViewModel() {
	const [items, setItems] = useState<Repo[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState<RepoFilter>(EMPTY_REPO_FILTER);
	const [editing, setEditing] = useState<Repo | null>(null);
	const [creating, setCreating] = useState(false);
	const ticket = useRef(0);

	const reload = useCallback(async () => {
		// Only the newest load may publish; see useTeamsViewModel.
		const mine = ++ticket.current;
		try {
			// Archived rows come down too and are hidden by the filter, so
			// switching status needs no round trip.
			const next = await listRepos(true);
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

	const visible = useMemo(() => filterRepos(items, filter), [items, filter]);

	/** Every provider present, so the filter offers only what exists. */
	const providers = useMemo(
		() => [...new Set(items.map((r) => r.provider))].sort(),
		[items],
	);

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

	/** Create and edit share one path; both throw so the dialog stays open. */
	const submit = useCallback(
		async (draft: RepoDraft) => {
			const body = {
				provider: draft.provider,
				org: draft.org.trim(),
				project: draft.project.trim(),
				name: draft.name.trim(),
				externalId: draft.externalId.trim(),
				// A blank GUID means "not backfilled yet", which the API spells
				// as null — sending "" would fail the server's string check.
				projectExternalId: draft.projectExternalId.trim() || null,
				enabled: draft.enabled,
			};
			if (editing) {
				await patchRepo(editing.id, body);
			} else {
				await createRepo(body);
			}
			await reload();
		},
		[editing, reload],
	);

	return {
		items,
		visible,
		providers,
		filter,
		setFilter,
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
		archive: (id: string) => mutate(() => archiveRepo(id)),
		restore: (id: string) => mutate(() => restoreRepo(id)),
	};
}

/** Draft state for the repo dialog; mirrors the team and tag ones. */
export function useRepoEditViewModel(
	repo: Repo | null,
	onSubmit: (draft: RepoDraft) => Promise<void>,
	onDone: () => void,
) {
	const [draft, setDraft] = useState<RepoDraft>(() => repoDraftFrom(repo));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Reset during render on an identity change, so the new row is correct on
	// first paint; see useDeveloperEditViewModel.
	const lastId = useRef<string | null>(repo?.id ?? null);
	const editingId = repo?.id ?? null;
	if (lastId.current !== editingId) {
		lastId.current = editingId;
		setDraft(repoDraftFrom(repo));
		setError(null);
		setBusy(false);
	}

	const setField = useCallback(
		<K extends keyof RepoDraft>(key: K, value: RepoDraft[K]) =>
			setDraft((d) => ({ ...d, [key]: value })),
		[],
	);

	const save = useCallback(async () => {
		if (busy) {
			return false;
		}
		const invalid = validateRepoDraft(draft);
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

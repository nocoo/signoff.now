import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tag, TagFilter } from "@/models/entities";
import { EMPTY_TAG_FILTER, filterTags } from "@/models/entities";
import {
	archiveTag,
	createTag,
	listTags,
	patchTag,
	restoreTag,
} from "@/models/entitiesApi";

export type TagDraft = { name: string; color: string };

/** The colour a brand-new tag starts on, before the user picks one. */
export const DEFAULT_TAG_COLOR = "#00A4EF";

export function tagDraftFrom(tag: Tag | null): TagDraft {
	return {
		name: tag?.name ?? "",
		color: tag?.color ?? DEFAULT_TAG_COLOR,
	};
}

/**
 * The server accepts `#RRGGBB` and nothing else (`normalizeColor`), so a
 * `hsl(...)` or a 3-digit hex is a 400 the user only discovers on save. An
 * `<input type="color">` cannot produce one, but a tag whose colour was set
 * before this check existed can still be edited here.
 */
export function validateTagDraft(draft: TagDraft): string | null {
	if (!draft.name.trim()) {
		return "Name is required";
	}
	if (!/^#[0-9A-Fa-f]{6}$/.test(draft.color.trim())) {
		return "Colour must be a #RRGGBB hex value";
	}
	return null;
}

/** Loading, filtering, create/edit and archival for the Tags page. */
export function useTagsViewModel() {
	const [items, setItems] = useState<Tag[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState<TagFilter>(EMPTY_TAG_FILTER);
	const [editing, setEditing] = useState<Tag | null>(null);
	const [creating, setCreating] = useState(false);
	const ticket = useRef(0);

	const reload = useCallback(async () => {
		// Only the newest load may publish; see useTeamsViewModel.
		const mine = ++ticket.current;
		try {
			// Archived rows come down too and are hidden by the filter, so
			// switching status needs no round trip.
			const next = await listTags(true);
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

	const visible = useMemo(() => filterTags(items, filter), [items, filter]);

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
		async (draft: TagDraft) => {
			const name = draft.name.trim();
			const color = draft.color.trim().toUpperCase();
			if (editing) {
				await patchTag(editing.id, { name, color });
			} else {
				await createTag(name, color);
			}
			await reload();
		},
		[editing, reload],
	);

	return {
		items,
		visible,
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
		archive: (id: string) => mutate(() => archiveTag(id)),
		restore: (id: string) => mutate(() => restoreTag(id)),
	};
}

/** Draft state for the tag dialog; mirrors the team one. */
export function useTagEditViewModel(
	tag: Tag | null,
	onSubmit: (draft: TagDraft) => Promise<void>,
	onDone: () => void,
) {
	const [draft, setDraft] = useState<TagDraft>(() => tagDraftFrom(tag));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Reset during render on an identity change, so the new row is correct on
	// first paint; see useDeveloperEditViewModel.
	const lastId = useRef<string | null>(tag?.id ?? null);
	const editingId = tag?.id ?? null;
	if (lastId.current !== editingId) {
		lastId.current = editingId;
		setDraft(tagDraftFrom(tag));
		setError(null);
		setBusy(false);
	}

	const setField = useCallback(
		<K extends keyof TagDraft>(key: K, value: TagDraft[K]) =>
			setDraft((d) => ({ ...d, [key]: value })),
		[],
	);

	const save = useCallback(async () => {
		if (busy) {
			return false;
		}
		const invalid = validateTagDraft(draft);
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

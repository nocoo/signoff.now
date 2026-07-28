import { useCallback, useRef, useState } from "react";
import type { Developer } from "@/models/entities";
import { validateAvatarUrl, validateDeveloperInput } from "@/models/entities";
import type { DeveloperDraft } from "./useDevelopersViewModel";

const EMPTY: DeveloperDraft = {
	name: "",
	alias: "",
	avatarUrl: "",
	teamIds: [],
	tagIds: [],
};

export function draftFrom(developer: Developer | null): DeveloperDraft {
	return developer
		? {
				name: developer.name,
				alias: developer.alias,
				avatarUrl: developer.avatarUrl ?? "",
				teamIds: developer.teamIds,
				tagIds: developer.tagIds,
			}
		: EMPTY;
}

/** First problem with a draft, or null. Order matters: identity before image. */
export function validateDraft(draft: DeveloperDraft): string | null {
	return (
		validateDeveloperInput(draft.name, draft.alias) ??
		validateAvatarUrl(draft.avatarUrl)
	);
}

/**
 * Draft state for the developer edit dialog.
 *
 * The draft resets from `developer` rather than on an open/close edge, so
 * switching straight from one row to another cannot briefly show the previous
 * person's details — the reset is driven by the identity being edited, not by
 * a lifecycle event that happens to fire near it.
 */
export function useDeveloperEditViewModel(
	developer: Developer | null,
	onSubmit: (draft: DeveloperDraft) => Promise<void>,
	onDone: () => void,
) {
	const [draft, setDraft] = useState<DeveloperDraft>(() =>
		draftFrom(developer),
	);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Reset when the row being edited CHANGES, not on every render that hands
	// down a new object for the same person — the latter would wipe what the
	// user is typing. Comparing the previous id during render (rather than in
	// an effect) also means the first paint already shows the new row, so the
	// old person's details are never briefly visible.
	const lastId = useRef<string | null>(developer?.id ?? null);
	const editingId = developer?.id ?? null;
	if (lastId.current !== editingId) {
		lastId.current = editingId;
		setDraft(draftFrom(developer));
		setError(null);
		setBusy(false);
	}

	const setField = useCallback(
		<K extends keyof DeveloperDraft>(key: K, value: DeveloperDraft[K]) =>
			setDraft((d) => ({ ...d, [key]: value })),
		[],
	);

	/** Add or remove one id from a draft list. Shared by teams and tags. */
	const toggle = useCallback(
		(key: "teamIds" | "tagIds", id: string) =>
			setDraft((d) => ({
				...d,
				[key]: d[key].includes(id)
					? d[key].filter((t) => t !== id)
					: [...d[key], id],
			})),
		[],
	);
	const toggleTeam = useCallback(
		(id: string) => toggle("teamIds", id),
		[toggle],
	);
	const toggleTag = useCallback((id: string) => toggle("tagIds", id), [toggle]);
	/** Select a tag that was just created, without toggling it off by mistake. */
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
		const invalid = validateDraft(draft);
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
			// Stay open on failure: closing would discard the edits along with
			// the explanation of why they did not save.
			setError(e instanceof Error ? e.message : "Save failed");
			return false;
		} finally {
			setBusy(false);
		}
	}, [busy, draft, onSubmit, onDone]);

	return {
		draft,
		setField,
		toggleTeam,
		toggleTag,
		selectTag,
		error,
		busy,
		save,
	};
}

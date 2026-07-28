import { useCallback, useRef, useState } from "react";
import type { Developer } from "@/models/entities";
import { validateAvatarUrl, validateDeveloperInput } from "@/models/entities";
import type { DeveloperDraft } from "./useDevelopersViewModel";

const EMPTY: DeveloperDraft = {
	name: "",
	alias: "",
	avatarUrl: "",
	teamIds: [],
};

export function draftFrom(developer: Developer | null): DeveloperDraft {
	return developer
		? {
				name: developer.name,
				alias: developer.alias,
				avatarUrl: developer.avatarUrl ?? "",
				teamIds: developer.teamIds,
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

	const toggleTeam = useCallback(
		(id: string) =>
			setDraft((d) => ({
				...d,
				teamIds: d.teamIds.includes(id)
					? d.teamIds.filter((t) => t !== id)
					: [...d.teamIds, id],
			})),
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

	return { draft, setField, toggleTeam, error, busy, save };
}

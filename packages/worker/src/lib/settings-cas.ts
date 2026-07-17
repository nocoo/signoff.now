/** Pure CAS outcome for Settings PUT version bump. */
export function settingsPutCasOutcome(bumpChanges: number): "ok" | "conflict" {
	return bumpChanges === 1 ? "ok" : "conflict";
}

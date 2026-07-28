import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { avatarColor } from "@/lib/avatar";
import type { Tag } from "@/models/entities";

export type TagPickerProps = {
	tags: Tag[];
	selected: string[];
	onToggle: (id: string) => void;
	/** Resolves once the new tag exists and is selected. */
	onCreate: (name: string) => Promise<void>;
	disabled?: boolean;
};

/**
 * Multi-select over existing tags, with inline creation.
 *
 * A new tag's colour is derived from its name rather than picked: the field is
 * required by the API, and asking someone to choose a hex value mid-edit is a
 * worse trade than a stable generated one they can change on the Tags page.
 */
export function TagPicker({
	tags,
	selected,
	onToggle,
	onCreate,
	disabled,
}: TagPickerProps) {
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const trimmed = draft.trim();
	const existing = tags.find(
		(t) => t.name.toLowerCase() === trimmed.toLowerCase(),
	);

	const add = async () => {
		if (!trimmed || busy) {
			return;
		}
		// Typing the name of a tag that already exists selects it instead of
		// failing on the server's unique constraint — the user's intent is the
		// same either way.
		if (existing) {
			if (!selected.includes(existing.id)) {
				onToggle(existing.id);
			}
			setDraft("");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await onCreate(trimmed);
			setDraft("");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not create tag");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				{tags.map((t) => {
					const on = selected.includes(t.id);
					return (
						<button
							type="button"
							key={t.id}
							aria-pressed={on}
							disabled={disabled}
							onClick={() => onToggle(t.id)}
							className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
								on
									? "border-transparent text-white"
									: "border-border text-muted-foreground hover:bg-secondary"
							}`}
							style={on ? { backgroundColor: t.color } : undefined}
						>
							<span
								className="h-2 w-2 rounded-full"
								style={{ backgroundColor: on ? "#fff" : t.color }}
							/>
							{t.name}
						</button>
					);
				})}
				{tags.length === 0 ? (
					<span className="text-xs text-muted-foreground">
						No tags yet — type one below.
					</span>
				) : null}
			</div>

			<div className="flex gap-2">
				<Input
					className="h-8 text-xs"
					placeholder="New tag…"
					value={draft}
					disabled={disabled || busy}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							// This sits inside a dialog; without this the Enter would
							// submit the whole form instead of adding the tag.
							e.preventDefault();
							void add();
						}
					}}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled || busy || !trimmed}
					onClick={() => void add()}
				>
					{busy ? "Adding…" : existing ? "Select" : "Add"}
				</Button>
			</div>

			{trimmed && !existing ? (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<span
						className="h-2 w-2 rounded-full"
						style={{ backgroundColor: avatarColor(trimmed) }}
					/>
					Colour is generated from the name; change it on the Tags page.
				</p>
			) : null}

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

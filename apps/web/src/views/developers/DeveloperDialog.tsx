import { useEffect, useId, useState } from "react";
import { EntityAvatar } from "@/components/EntityAvatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Developer, Team } from "@/models/entities";
import { validateAvatarUrl, validateDeveloperInput } from "@/models/entities";

export type DeveloperDraft = {
	name: string;
	alias: string;
	avatarUrl: string;
	teamIds: string[];
};

export type DeveloperDialogProps = {
	developer: Developer | null;
	teams: Team[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: DeveloperDraft) => Promise<void>;
};

/** Edit one developer: identity, avatar and team membership in one place. */
export function DeveloperDialog({
	developer,
	teams,
	open,
	onOpenChange,
	onSubmit,
}: DeveloperDialogProps) {
	const nameId = useId();
	const aliasId = useId();
	const avatarId = useId();
	const [draft, setDraft] = useState<DeveloperDraft>({
		name: "",
		alias: "",
		avatarUrl: "",
		teamIds: [],
	});
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Reset from the row each time the dialog opens, so a cancelled edit does
	// not leak into the next one.
	useEffect(() => {
		if (open && developer) {
			setDraft({
				name: developer.name,
				alias: developer.alias,
				avatarUrl: developer.avatarUrl ?? "",
				teamIds: developer.teamIds,
			});
			setError(null);
		}
	}, [open, developer]);

	const save = async () => {
		const invalid =
			validateDeveloperInput(draft.name, draft.alias) ??
			validateAvatarUrl(draft.avatarUrl);
		if (invalid) {
			setError(invalid);
			return;
		}
		setBusy(true);
		try {
			await onSubmit(draft);
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed");
		} finally {
			setBusy(false);
		}
	};

	const toggleTeam = (id: string) =>
		setDraft((d) => ({
			...d,
			teamIds: d.teamIds.includes(id)
				? d.teamIds.filter((t) => t !== id)
				: [...d.teamIds, id],
		}));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit developer</DialogTitle>
					<DialogDescription>
						The alias drives identity matching; changing it re-runs scoring.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-3">
					<EntityAvatar
						name={draft.name}
						avatarUrl={draft.avatarUrl}
						size="lg"
					/>
					<p className="text-xs text-muted-foreground">
						Falls back to an initial on a colour derived from the name.
					</p>
				</div>

				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor={nameId}>Name</Label>
						<Input
							id={nameId}
							value={draft.name}
							onChange={(e) =>
								setDraft((d) => ({ ...d, name: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={aliasId}>Alias</Label>
						<Input
							id={aliasId}
							value={draft.alias}
							onChange={(e) =>
								setDraft((d) => ({ ...d, alias: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={avatarId}>Avatar URL</Label>
						<Input
							id={avatarId}
							value={draft.avatarUrl}
							placeholder="https://…"
							onChange={(e) =>
								setDraft((d) => ({ ...d, avatarUrl: e.target.value }))
							}
						/>
					</div>
					{teams.length > 0 ? (
						<fieldset className="space-y-1.5">
							<legend className="text-sm font-medium">Teams</legend>
							<div className="flex flex-wrap gap-2">
								{teams.map((t) => {
									const on = draft.teamIds.includes(t.id);
									return (
										<button
											type="button"
											key={t.id}
											aria-pressed={on}
											onClick={() => toggleTeam(t.id)}
											className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
												on
													? "border-primary bg-primary/10 text-foreground"
													: "border-border text-muted-foreground hover:bg-secondary"
											}`}
										>
											<EntityAvatar
												name={t.name}
												avatarUrl={t.avatarUrl}
												size="sm"
											/>
											{t.name}
										</button>
									);
								})}
							</div>
						</fieldset>
					) : null}
				</div>

				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={busy} onClick={() => void save()}>
						{busy ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

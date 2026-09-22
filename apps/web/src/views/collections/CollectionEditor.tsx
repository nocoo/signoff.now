import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import type { DataSource } from "@signoff/domain/monitoring";
import {
	type PrCollection,
	type PrCollectionWrite,
	prCollectionWriteSchema,
} from "@signoff/domain/pr-collections";
import { Check } from "lucide-react";
import { useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { cn } from "@/lib/utils";
import { saveCollection } from "@/models/prCollectionsApi";
import { useCollectionMutation } from "@/viewmodels/usePrCollections";
import {
	COLLECTION_COLORS,
	COLLECTION_ICONS,
	CollectionIcon,
	collectionStyle,
} from "./CollectionIdentity";

export function CollectionEditor({
	source,
	collection,
	onClose,
	onSaved,
}: {
	source: DataSource;
	collection?: PrCollection;
	onClose: () => void;
	onSaved: (c: PrCollection) => Promise<unknown>;
}) {
	const [opener] = useState(() => document.activeElement);
	const [draft, setDraft] = useState<PrCollectionWrite>(
		collection ?? {
			name: "",
			description: "",
			color: "violet",
			icon: "layers",
		},
	);
	const mutation = useCollectionMutation(() => Promise.resolve());
	const [validation, setValidation] = useState<string | null>(null);
	async function submit() {
		const parsed = prCollectionWriteSchema.safeParse({
			name: draft.name,
			description: draft.description,
			color: draft.color,
			icon: draft.icon,
		});
		if (!parsed.success) {
			setValidation(
				"Enter a name (up to 80 characters) and a description of up to 1,000 characters.",
			);
			return;
		}
		setValidation(null);
		const saved = await mutation.run(() =>
			saveCollection(source, parsed.data, collection),
		);
		if (saved) {
			await onSaved(saved);
			onClose();
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.busy) onClose();
			}}
		>
			<DialogContent
				size="lg"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (opener instanceof HTMLElement) opener.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{collection ? "Edit collection" : "New collection"}
					</DialogTitle>
					<DialogDescription>
						Give a group of PRs a shared purpose. Membership stays intact as PRs
						merge or close.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
					className="space-y-4"
				>
					<fieldset disabled={mutation.busy} className="space-y-4">
						<div className="flex items-center gap-3 rounded-basalt-lg border border-basalt-border bg-basalt-muted/30 p-3">
							<CollectionIcon collection={draft} />
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold">
									{draft.name.trim() || "Your next collection"}
								</p>
								<p className="text-xs text-basalt-muted-foreground">
									One purpose. Every PR accounted for.
								</p>
							</div>
						</div>
						<Field label="Name">
							<Input
								autoFocus
								aria-label="Collection name"
								maxLength={80}
								placeholder="e.g. Release readiness"
								value={draft.name}
								onChange={(e) => setDraft({ ...draft, name: e.target.value })}
							/>
						</Field>
						<Field label="Purpose">
							<InputArea
								aria-label="Collection purpose"
								maxLength={1000}
								rows={3}
								placeholder="What are these PRs working toward?"
								value={draft.description}
								onChange={(e) =>
									setDraft({ ...draft, description: e.target.value })
								}
							/>
						</Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field label="Icon">
								<div className="flex flex-wrap gap-1">
									{Object.entries(COLLECTION_ICONS).map(([value, Icon]) => (
										<Button
											key={value}
											type="button"
											variant={draft.icon === value ? "secondary" : "ghost"}
											size="icon"
											className="size-8"
											aria-label={`${value} icon`}
											aria-pressed={draft.icon === value}
											onClick={() =>
												setDraft({
													...draft,
													icon: value as PrCollection["icon"],
												})
											}
										>
											<Icon className="size-4" />
										</Button>
									))}
								</div>
							</Field>
							<Field label="Color">
								<div className="flex flex-wrap gap-1">
									{Object.keys(COLLECTION_COLORS).map((value) => (
										<Button
											key={value}
											type="button"
											variant="ghost"
											size="icon"
											className={cn(
												"size-8",
												draft.color === value && "ring-1 ring-basalt-ring",
											)}
											style={collectionStyle(value as PrCollection["color"])}
											aria-label={`${value} color`}
											aria-pressed={draft.color === value}
											onClick={() =>
												setDraft({
													...draft,
													color: value as PrCollection["color"],
												})
											}
										>
											<span className="flex size-5 items-center justify-center rounded-full bg-[hsl(var(--collection-color))]">
												{draft.color === value ? (
													<Check className="size-3 text-white" />
												) : null}
											</span>
										</Button>
									))}
								</div>
							</Field>
						</div>
					</fieldset>
					{validation || mutation.error ? (
						<AlertBanner variant="error">
							{validation || mutation.error}
						</AlertBanner>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={mutation.busy}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={mutation.busy}>
							{mutation.busy
								? "Saving…"
								: collection
									? "Save changes"
									: "Create collection"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

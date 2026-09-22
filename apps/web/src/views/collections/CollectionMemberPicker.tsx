import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	LayerCard,
} from "@nocoo/basalt";
import type { DataSource } from "@signoff/domain/monitoring";
import type { PrCollection } from "@signoff/domain/pr-collections";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { loadPulls, queryRow } from "@/models/monitoringApi";
import { changeMembers } from "@/models/prCollectionsApi";
import {
	useCollectionMutation,
	useCollectionSearch,
	usePrMemberships,
} from "@/viewmodels/usePrCollections";
import { useQueryBlock } from "@/viewmodels/useQueryBlock";
import { LifecycleBadge } from "../workbench/WorkbenchStatus";

export function CollectionMemberPicker({
	source,
	collection: c,
	onClose,
	onChanged,
}: {
	source: DataSource;
	collection: PrCollection;
	onClose: () => void;
	onChanged: () => Promise<unknown>;
}) {
	const [opener] = useState(() => document.activeElement);
	const search = useCollectionSearch(),
		[page, setPage] = useState(1),
		[selected, setSelected] = useState(new Set<string>());
	const query = new URLSearchParams({
		source: c.source,
		state: "all",
		draft: "include",
		q: search.query,
		limit: "20",
		page: String(page),
		sort: "updated",
		direction: "desc",
	}).toString();
	const pulls = useQueryBlock(
		`collection-picker:${query}`,
		(signal) => loadPulls(query, signal),
		0,
	);
	const membership = usePrMemberships(
		source,
		pulls.data?.data.map((p) => p.id) ?? [],
	);
	const existing = new Set(
		membership.data?.items
			.filter((m) => m.collectionId === c.id)
			.map((m) => m.pullId),
	);
	const mutation = useCollectionMutation(onChanged);
	const total = pulls.data?.page.total ?? 0;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.busy) onClose();
			}}
		>
			<DialogContent
				size="xl"
				className="flex max-h-[85dvh] flex-col gap-4"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (opener instanceof HTMLElement) opener.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>Add PRs to {c.name}</DialogTitle>
					<DialogDescription>
						Search cached PRs across all states. Adding members does not change
						the watch list.
					</DialogDescription>
				</DialogHeader>
				<div className="relative">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-basalt-muted-foreground" />
					<Input
						autoFocus
						aria-label="Find PRs to add"
						className="pl-9"
						placeholder="Search title, #number, repository or author…"
						value={search.search}
						onChange={(e) => {
							search.setSearch(e.target.value);
							setPage(1);
						}}
					/>
				</div>
				{mutation.error || pulls.error || membership.error ? (
					<AlertBanner variant="error">
						{mutation.error || pulls.error || membership.error}
					</AlertBanner>
				) : null}
				<section
					className="min-h-32 flex-1 overflow-y-auto rounded-basalt-lg border border-basalt-border"
					aria-label="PR candidates"
				>
					{pulls.loading ? (
						<LayerCard.Loading label="Searching cached PRs" />
					) : null}
					{pulls.data?.data.map((item) => {
						const pull = queryRow(item).pull,
							added = existing.has(item.id);
						return (
							<label
								key={item.id}
								htmlFor={`candidate-${item.id}`}
								className="flex cursor-pointer items-start gap-3 border-b border-basalt-border/60 p-3 last:border-0 hover:bg-basalt-muted/30"
							>
								<Checkbox
									id={`candidate-${item.id}`}
									aria-label={`Select PR #${item.number}`}
									className="mt-0.5"
									disabled={
										mutation.busy ||
										membership.loading ||
										Boolean(membership.error) ||
										added ||
										(!selected.has(item.id) && selected.size >= 200)
									}
									checked={added || selected.has(item.id)}
									onCheckedChange={(checked) =>
										setSelected((current) => {
											const next = new Set(current);
											if (checked === true) next.add(item.id);
											else next.delete(item.id);
											return next;
										})
									}
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-xs font-medium">
										{item.title}
									</span>
									<span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-basalt-muted-foreground">
										<span className="font-mono">#{item.number}</span>
										<span>{item.repository.name}</span>
										<LifecycleBadge pull={pull} />
										{added ? (
											<span className="ml-auto flex items-center gap-1 text-basalt-success">
												<Check className="size-3" />
												Added
											</span>
										) : null}
									</span>
								</span>
							</label>
						);
					})}
					{!pulls.loading && !pulls.error && total === 0 ? (
						<p className="p-8 text-center text-xs text-basalt-muted-foreground">
							No matching PRs in the cache.
						</p>
					) : null}
				</section>
				<div className="flex items-center justify-between gap-2 text-xs text-basalt-muted-foreground">
					<span>
						{selected.size} selected · {total} matching PRs
					</span>
					<div className="flex items-center gap-2">
						<Button
							size="icon"
							variant="ghost"
							aria-label="Previous candidate page"
							disabled={page <= 1 || pulls.refreshing}
							onClick={() => setPage(page - 1)}
						>
							<ChevronLeft className="size-4" />
						</Button>
						<span className="tabular-nums">
							{page} / {Math.max(1, Math.ceil(total / 20))}
						</span>
						<Button
							size="icon"
							variant="ghost"
							aria-label="Next candidate page"
							disabled={page * 20 >= total || pulls.refreshing}
							onClick={() => setPage(page + 1)}
						>
							<ChevronRight className="size-4" />
						</Button>
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" disabled={mutation.busy} onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={mutation.busy || !selected.size}
						onClick={() =>
							void mutation
								.run(() => changeMembers(source, c, [...selected], "add"))
								.then((saved) => {
									if (saved) onClose();
								})
						}
					>
						{mutation.busy
							? "Adding…"
							: `Add ${selected.size || ""} PR${selected.size === 1 ? "" : "s"}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Checkbox,
	Input,
	LayerCard,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { DataSource } from "@signoff/domain/monitoring";
import type { PrCollection } from "@signoff/domain/pr-collections";
import {
	ArrowLeft,
	ArrowUpRight,
	Eye,
	GitMerge,
	Layers3,
	Pencil,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import {
	changeMembers,
	collectionHref,
	deleteCollection,
} from "@/models/prCollectionsApi";
import { nextPullSort, relativeTime } from "@/models/workbench";
import { pullHref } from "@/models/workspaceLocation";
import { useAiScheduleViewModel } from "@/viewmodels/useAiScheduleViewModel";
import {
	useCollectionMutation,
	useCollectionPullList,
	useCollectionSearch,
	usePrCollections,
} from "@/viewmodels/usePrCollections";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PullFilters } from "../workbench/PullFilters";
import { PullList } from "../workbench/PullList";
import { CollectionEditor } from "./CollectionEditor";
import {
	CollectionIcon,
	CollectionProgress,
	collectionStyle,
} from "./CollectionIdentity";
import { CollectionMemberPicker } from "./CollectionMemberPicker";
import { PrCollectionMembershipProvider } from "./PrCollectionMemberships";

export function CollectionsPage() {
	const { filter } = useWorkbench();
	const { id } = useParams();
	return (
		<CollectionWorkspace
			key={`${filter.source}:${id ?? "index"}`}
			source={filter.source}
			id={id}
		/>
	);
}
function CollectionWorkspace({
	source,
	id,
}: {
	source: DataSource;
	id?: string;
}) {
	const catalog = usePrCollections(source),
		navigate = useNavigate();
	const [editing, setEditing] = useState<PrCollection | null | undefined>();
	const search = useCollectionSearch();
	const collection = catalog.data?.items.find((c) => c.id === id);
	const items = (catalog.data?.items ?? []).filter((c) =>
		`${c.name} ${c.description}`
			.toLowerCase()
			.includes(search.query.toLowerCase()),
	);
	return (
		<div className="space-y-4">
			{id ? (
				<Button
					asChild
					variant="link"
					size="sm"
					className="h-6 p-0 text-xs text-basalt-muted-foreground"
				>
					<Link
						to={`/collections?source=${source === "cli" ? "live" : "sample"}`}
					>
						<ArrowLeft className="size-3.5" />
						All collections
					</Link>
				</Button>
			) : (
				<PageHeader
					title="Collections"
					description="Keep every PR in view, from the first draft to the final merge."
					actions={
						<Button size="sm" onClick={() => setEditing(null)}>
							<Plus className="size-4" />
							New collection
						</Button>
					}
				/>
			)}
			{catalog.error ? (
				<AlertBanner variant="error">
					{catalog.error}
					<Button
						variant="link"
						size="sm"
						onClick={() => void catalog.reload()}
					>
						Retry
					</Button>
				</AlertBanner>
			) : null}
			{catalog.loading ? (
				<LayerCard.Loading label="Loading collections" />
			) : id ? (
				collection ? (
					<CollectionDetail
						key={collection.id}
						source={source}
						collection={collection}
						reload={catalog.reload}
						onEdit={() => setEditing(collection)}
					/>
				) : !catalog.error ? (
					<EmptyState
						icon={Layers3}
						title="Collection not found"
						description="It may have been deleted or belong to the other data source."
					/>
				) : null
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-xs text-basalt-muted-foreground">
							{catalog.data?.items.length ?? 0} collections{" "}
							<span className="mx-2">·</span> All PR states included
						</p>
						<div className="relative w-full sm:w-64">
							<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-basalt-muted-foreground" />
							<Input
								aria-label="Find collections"
								className="h-8 pl-9 text-xs"
								placeholder="Find a collection…"
								value={search.search}
								onChange={(e) => search.setSearch(e.target.value)}
							/>
						</div>
					</div>
					{items.length ? (
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							{items.map((c) => (
								<CollectionCard key={c.id} collection={c} />
							))}
						</div>
					) : !catalog.error ? (
						<EmptyState
							icon={Layers3}
							title={
								search.query
									? "No matching collections"
									: "Make room for the work that matters"
							}
							description="Group a release, a testing effort, or a shared goal. PRs stay here after they merge or close."
							action={
								<Button size="sm" onClick={() => setEditing(null)}>
									<Plus className="size-4" />
									New collection
								</Button>
							}
						/>
					) : null}
				</>
			)}
			{editing !== undefined ? (
				<CollectionEditor
					source={source}
					collection={editing ?? undefined}
					onClose={() => setEditing(undefined)}
					onSaved={async (c) => {
						await catalog.reload();
						if (!editing) navigate(collectionHref(c));
					}}
				/>
			) : null}
		</div>
	);
}
function CollectionCard({ collection: c }: { collection: PrCollection }) {
	return (
		<Link
			to={collectionHref(c)}
			style={collectionStyle(c.color)}
			className="group relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-basalt-xl border border-basalt-border bg-basalt-card p-4 transition-colors hover:border-[hsl(var(--collection-color)/0.6)] hover:bg-basalt-muted/20 focus-visible:outline-2 focus-visible:outline-basalt-ring"
		>
			<span className="absolute inset-x-0 top-0 h-0.5 bg-[hsl(var(--collection-color))]" />
			<div className="flex items-start gap-3">
				<CollectionIcon collection={c} />
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-sm font-semibold">{c.name}</h2>
					<p className="mt-1 text-xs text-basalt-muted-foreground">
						{c.counts.total} pull requests
					</p>
				</div>
				<ArrowUpRight className="size-4 text-basalt-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
			</div>
			<p className="line-clamp-2 min-h-8 text-xs leading-5 text-basalt-muted-foreground">
				{c.description || "A shared view of work in progress."}
			</p>
			<CollectionProgress collection={c} />
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-basalt-muted-foreground">
				<span className="text-basalt-info">{c.counts.open} open</span>
				<span>{c.counts.draft} draft</span>
				<span>{c.counts.closed} closed</span>
				<span className="ml-auto">
					Updated {relativeTime(c.updatedAt, Math.floor(Date.now() / 1000))}
				</span>
			</div>
		</Link>
	);
}
function CollectionDetail({
	source,
	collection: c,
	reload,
	onEdit,
}: {
	source: DataSource;
	collection: PrCollection;
	reload: () => Promise<unknown>;
	onEdit: () => void;
}) {
	const workbench = useWorkbench();
	const aiSchedule = useAiScheduleViewModel(source);
	const list = useCollectionPullList(source, c.id);
	const { pulls, rows } = list;
	const [adding, setAdding] = useState(false),
		[removing, setRemoving] = useState(false);
	const navigate = useNavigate();
	const mutation = useCollectionMutation(async () => {
		await Promise.all([reload(), pulls.reload()]);
	});
	const watchMutation = useCollectionMutation(pulls.reload);
	const busy = mutation.busy || watchMutation.busy || Boolean(workbench.busy);
	const count = pulls.data?.page.total ?? 0;
	return (
		<>
			<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:flex sm:flex-wrap">
				<CollectionIcon collection={c} />
				<div className="min-w-0 flex-1">
					<h1 className="break-words text-xl font-semibold tracking-tight">
						{c.name}
					</h1>
					<p className="mt-1 max-w-3xl whitespace-pre-wrap break-words text-xs leading-5 text-basalt-muted-foreground">
						{c.description || "All members, across every PR state."}
					</p>
				</div>
				<div className="col-span-2 flex items-center justify-end gap-1 sm:ml-auto">
					<Button
						size="icon"
						variant="ghost"
						aria-label="Edit collection"
						onClick={onEdit}
					>
						<Pencil className="size-4" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						aria-label="Delete collection"
						onClick={() => setRemoving(true)}
					>
						<Trash2 className="size-4" />
					</Button>
					<Button size="sm" onClick={() => setAdding(true)}>
						<Plus className="size-4" />
						Add PRs
					</Button>
				</div>
			</div>
			<div className="grid items-center gap-4 rounded-basalt-lg border border-basalt-border bg-basalt-muted/20 px-4 py-3 sm:grid-cols-[minmax(200px,1fr)_auto]">
				<CollectionProgress collection={c} />
				<p className="flex items-center gap-2 text-xs text-basalt-muted-foreground">
					<GitMerge className="size-4 text-basalt-badge-purple" />
					Completion means merged. Closed PRs remain visible.
				</p>
			</div>
			{mutation.error || watchMutation.error || pulls.error ? (
				<AlertBanner variant="error">
					{mutation.error || watchMutation.error || pulls.error}
					<Button variant="link" size="sm" onClick={() => void pulls.reload()}>
						Retry
					</Button>
				</AlertBanner>
			) : null}
			<LayerCard
				padding="sm"
				className="space-y-2.5"
				aria-label="PR filters"
				role="region"
			>
				<PullFilters vm={list} />
			</LayerCard>
			<PrCollectionMembershipProvider
				source={source}
				ids={rows.map((row) => row.pull.id)}
			>
				<LayerCard padding="none">
					<LayerCard.Header className="flex-wrap gap-2 px-3 py-1">
						<span className="text-xs text-basalt-muted-foreground tabular-nums">
							{list.selectedIds.size
								? `${list.selectedIds.size} selected`
								: `${count} PRs · Select PRs to watch or remove`}
						</span>
						{list.selectedIds.size > 0 ? (
							<>
								<Button
									size="sm"
									className="h-6 px-2 text-[11px]"
									disabled={
										busy ||
										!list.selectedRows.some(
											(row) =>
												row.pull.state === "open" &&
												!row.observation?.active &&
												!row.watchPending,
										)
									}
									onClick={() =>
										void watchMutation.run(() =>
											workbench.watchRows(list.selectedRows),
										)
									}
								>
									<Eye className="size-3.5" />
									Add to watch list
								</Button>
								<Button
									size="sm"
									variant="outline"
									className="h-6 px-2 text-[11px] text-basalt-destructive"
									disabled={busy}
									onClick={() =>
										void mutation.run(() =>
											changeMembers(source, c, [...list.selectedIds], "remove"),
										)
									}
								>
									<Trash2 className="size-3.5" />
									Remove from collection
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="h-6 px-2 text-[11px]"
									disabled={busy}
									onClick={() => list.selectAll(false)}
								>
									Clear selection
								</Button>
							</>
						) : null}
					</LayerCard.Header>
					{workbench.feedbackKind === "watch" &&
					(workbench.mutationError || workbench.notice) ? (
						<p
							role="status"
							className={`px-3 py-2 text-xs ${workbench.mutationError ? "text-basalt-destructive" : "text-basalt-muted-foreground"}`}
						>
							{workbench.mutationError || workbench.notice}
						</p>
					) : null}
					<PullList
						label="Collection pull requests"
						rows={rows}
						loading={pulls.loading}
						busy={busy}
						sort={list.filter}
						onSort={(column) =>
							list.setFilter(nextPullSort(list.filter, column))
						}
						selection={{
							ids: list.selectedIds,
							onToggle: list.toggleSelection,
							canSelect: () => true,
							header: (
								<Checkbox
									aria-label="Select all collection PRs"
									disabled={busy || pulls.loading || !rows.length}
									checked={
										list.selectedIds.size === rows.length && rows.length > 0
											? true
											: list.selectedIds.size > 0
												? "indeterminate"
												: false
									}
									onCheckedChange={(checked) =>
										list.selectAll(checked === true)
									}
								/>
							),
						}}
						aiSchedule={aiSchedule.error ? null : aiSchedule.data}
						onOpen={(row) => navigate(pullHref(row.project, row.pull))}
						onToggleWatch={(row) =>
							void watchMutation.run(() => workbench.toggleWatchRow(row))
						}
						actions={(row) => (
							<Button
								size="icon"
								variant="ghost"
								className="size-7 text-basalt-muted-foreground"
								aria-label={`Remove PR #${row.pull.number} from collection`}
								title="Remove from this collection"
								disabled={mutation.busy}
								onClick={() =>
									void mutation.run(() =>
										changeMembers(source, c, [row.pull.id], "remove"),
									)
								}
							>
								<Trash2 className="size-3.5" />
							</Button>
						)}
					/>
					{!pulls.loading && count === 0 && !pulls.error ? (
						<EmptyState
							compact
							icon={Layers3}
							title={
								c.counts.total ? "No matching PRs" : "Your collection is ready"
							}
							description={
								c.counts.total
									? "Try another state or search."
									: "Add PRs from the cache. Draft, merged and closed PRs are welcome."
							}
							action={
								<Button size="sm" onClick={() => setAdding(true)}>
									<Plus className="size-4" />
									Add PRs
								</Button>
							}
						/>
					) : null}
				</LayerCard>
			</PrCollectionMembershipProvider>
			{adding ? (
				<CollectionMemberPicker
					source={source}
					collection={c}
					onClose={() => setAdding(false)}
					onChanged={async () => {
						await Promise.all([reload(), pulls.reload()]);
					}}
				/>
			) : null}
			<AlertDialog
				open={removing}
				onOpenChange={(open) => {
					if (!mutation.busy) setRemoving(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete “{c.name}”?</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes the collection and its memberships. PRs, watches and
							other collections are kept.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{mutation.error ? (
						<AlertBanner variant="error">{mutation.error}</AlertBanner>
					) : null}
					<AlertDialogFooter>
						<Button
							variant="ghost"
							disabled={mutation.busy}
							onClick={() => setRemoving(false)}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={mutation.busy}
							onClick={() =>
								void mutation.run(async () => {
									const result = await deleteCollection(source, c);
									navigate(`/collections?source=${c.source}`);
									return result;
								})
							}
						>
							{mutation.busy ? "Deleting…" : "Delete collection"}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Input,
	LayerCard,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { DataSource } from "@signoff/domain/monitoring";
import type { PrCollection } from "@signoff/domain/pr-collections";
import {
	ArrowLeft,
	ArrowUpRight,
	GitMerge,
	Layers3,
	Pencil,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { loadPulls, queryRow } from "@/models/monitoringApi";
import {
	changeMembers,
	collectionHref,
	deleteCollection,
} from "@/models/prCollectionsApi";
import {
	nextPullSort,
	type PullFilter,
	relativeTime,
} from "@/models/workbench";
import { pullHref } from "@/models/workspaceLocation";
import { useAiScheduleViewModel } from "@/viewmodels/useAiScheduleViewModel";
import {
	useCollectionMutation,
	useCollectionSearch,
	usePrCollections,
} from "@/viewmodels/usePrCollections";
import { useQueryBlock } from "@/viewmodels/useQueryBlock";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PullList, PullListPagination } from "../workbench/PullList";
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
	const [sort, setSort] = useState<Pick<PullFilter, "sort" | "sortDirection">>({
		sort: "updated",
		sortDirection: "desc",
	});
	const [adding, setAdding] = useState(false),
		[removing, setRemoving] = useState(false),
		[page, setPage] = useState(1),
		[state, setState] = useState("all");
	const search = useCollectionSearch(),
		navigate = useNavigate();
	const query = new URLSearchParams({
		source: c.source,
		collectionId: c.id,
		state: state === "draft" ? "open" : state,
		draft:
			state === "draft" ? "only" : state === "open" ? "exclude" : "include",
		q: search.query,
		limit: "20",
		page: String(page),
		sort: sort.sort,
		direction: sort.sortDirection,
	}).toString();
	const pulls = useQueryBlock(`collection-prs:${query}`, (signal) =>
		loadPulls(query, signal),
	);
	const mutation = useCollectionMutation(async () => {
		await Promise.all([reload(), pulls.reload()]);
	});
	const watchMutation = useCollectionMutation(pulls.reload);
	const rows =
		pulls.data?.data.map((item) => workbench.withWatchState(queryRow(item))) ??
		[];
	const total = pulls.data?.page.total;
	useEffect(() => {
		if (total !== undefined)
			setPage((current) =>
				Math.min(current, Math.max(1, Math.ceil(total / 20))),
			);
	}, [total]);
	const count = total ?? 0;
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
			<div className="flex flex-wrap items-center justify-between gap-3">
				<fieldset
					className="flex flex-wrap gap-1"
					aria-label="Collection PR state"
				>
					{["all", "open", "draft", "merged", "closed"].map((value) => (
						<Button
							key={value}
							variant={state === value ? "secondary" : "ghost"}
							size="sm"
							className="h-8 gap-2 text-xs capitalize"
							aria-pressed={state === value}
							onClick={() => {
								setState(value);
								setPage(1);
							}}
						>
							{value}
							<span className="font-mono text-[11px] text-basalt-muted-foreground">
								{value === "all"
									? c.counts.total
									: c.counts[value as "open" | "draft" | "merged" | "closed"]}
							</span>
						</Button>
					))}
				</fieldset>
				<Input
					aria-label="Search collection PRs"
					className="h-8 w-full text-xs sm:w-64"
					placeholder="Search title, number, author…"
					value={search.search}
					onChange={(e) => {
						search.setSearch(e.target.value);
						setPage(1);
					}}
				/>
			</div>
			<PrCollectionMembershipProvider
				source={source}
				ids={rows.map((row) => row.pull.id)}
			>
				<LayerCard padding="none">
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
						busy={
							mutation.busy || watchMutation.busy || Boolean(workbench.busy)
						}
						sort={sort}
						onSort={(column) => {
							setSort(nextPullSort(sort, column));
							setPage(1);
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
					<PullListPagination
						page={page}
						pageSize={20}
						total={count}
						loaded={pulls.data !== null}
						loading={pulls.loading}
						busy={pulls.refreshing}
						onPage={setPage}
					/>
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

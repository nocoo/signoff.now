import { Tag as TagIcon } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusFilter } from "@/models/entities";
import { useTagsViewModel } from "@/viewmodels/useTagsViewModel";
import { TagDialog } from "./TagDialog";

export function TagsPage() {
	const vm = useTagsViewModel();

	return (
		<div className="space-y-6">
			<PageHeader
				title="Tags"
				description="Color labels for developers (filtering and comparison)."
			/>
			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<section className="flex flex-wrap items-end gap-(--control-gap-x)">
				<Field label="Search" className="w-56">
					{(id) => (
						<Input
							id={id}
							value={vm.filter.keyword}
							placeholder="Tag name"
							onChange={(e) =>
								vm.setFilter((f) => ({ ...f, keyword: e.target.value }))
							}
						/>
					)}
				</Field>
				<Field label="Status" className="w-36">
					{(id) => (
						<Select
							id={id}
							value={vm.filter.status}
							onChange={(e) =>
								vm.setFilter((f) => ({
									...f,
									status: e.target.value as StatusFilter,
								}))
							}
						>
							<option value="active">Active</option>
							<option value="archived">Archived</option>
							<option value="all">All</option>
						</Select>
					)}
				</Field>
				<div className="ml-auto flex items-center gap-3 pb-0.5">
					<p className="text-xs text-muted-foreground">
						{vm.visible.length} of {vm.items.length}
					</p>
					<Button onClick={() => vm.setCreating(true)}>Add tag</Button>
				</div>
			</section>

			{vm.loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-10 w-full" />
				</div>
			) : vm.visible.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={TagIcon}
						title={vm.items.length === 0 ? "No tags" : "No matches"}
						description={
							vm.items.length === 0
								? "Add named color tags to classify developers."
								: "No tag matches the current filters."
						}
					/>
				</div>
			) : (
				<ul className="rounded-[var(--radius-card)] bg-secondary divide-y divide-border">
					{vm.visible.map((t) => (
						<li
							key={t.id}
							className="flex items-center justify-between px-4 py-3 text-sm hover:bg-background/50"
						>
							<span className="flex items-center gap-2 font-medium">
								<span
									className="inline-block h-3 w-3 rounded-full ring-1 ring-border"
									style={{ background: t.color }}
								/>
								{t.name}
								<span className="font-mono text-xs text-muted-foreground">
									{t.color}
								</span>
							</span>
							<span className="space-x-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => vm.setEditing(t)}
								>
									Edit
								</Button>
								{t.archivedAt === null ? (
									<Button
										variant="destructive"
										size="sm"
										disabled={vm.busy}
										onClick={() => void vm.archive(t.id)}
									>
										Archive
									</Button>
								) : (
									<Button
										variant="outline"
										size="sm"
										disabled={vm.busy}
										onClick={() => void vm.restore(t.id)}
									>
										Restore
									</Button>
								)}
							</span>
						</li>
					))}
				</ul>
			)}

			<TagDialog
				tag={vm.editing}
				open={vm.dialogOpen}
				onOpenChange={(o) => {
					if (!o) {
						vm.closeDialog();
					}
				}}
				onSubmit={vm.submit}
			/>
		</div>
	);
}

import { Button, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Tag as TagIcon } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { SelectControl as Select } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
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

			<section className="flex flex-wrap items-end gap-3">
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
							onChange={(value) =>
								vm.setFilter((f) => ({
									...f,
									status: value as StatusFilter,
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
					<p className="text-xs text-basalt-muted-foreground">
						{vm.visible.length} of {vm.items.length}
					</p>
					<Button onClick={() => vm.setCreating(true)}>Add tag</Button>
				</div>
			</section>

			{vm.loading ? (
				<LayerCard className="space-y-2">
					<Skeleton className="h-10 w-full" />
				</LayerCard>
			) : vm.visible.length === 0 ? (
				<LayerCard padding="none">
					<EmptyState
						icon={TagIcon}
						title={vm.items.length === 0 ? "No tags" : "No matches"}
						description={
							vm.items.length === 0
								? "Add named color tags to classify developers."
								: "No tag matches the current filters."
						}
					/>
				</LayerCard>
			) : (
				<LayerCard padding="none">
					<ul className="divide-y divide-basalt-border">
						{vm.visible.map((t) => (
							<li
								key={t.id}
								className="flex items-center justify-between px-4 py-3 text-sm hover:bg-basalt-background/50"
							>
								<span className="flex items-center gap-2 font-medium">
									<span
										className="inline-block h-3 w-3 rounded-full ring-1 ring-basalt-border"
										style={{ background: t.color }}
									/>
									{t.name}
									<span className="font-mono text-xs text-basalt-muted-foreground">
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
				</LayerCard>
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

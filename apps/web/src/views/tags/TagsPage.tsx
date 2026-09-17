import { Button, Field, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { Tag as TagIcon } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityTag } from "@/components/EntityTag";
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
				actions={
					<>
						<p className="text-xs text-basalt-muted-foreground">
							{vm.visible.length} of {vm.items.length}
						</p>
						<Button onClick={() => vm.setCreating(true)}>Add tag</Button>
					</>
				}
			/>
			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<LayerCard
				role="search"
				aria-label="Tags filters"
				className="flex flex-wrap items-end gap-3"
			>
				<Field label="Search" className="w-56">
					<Input
						value={vm.filter.keyword}
						placeholder="Tag name"
						onChange={(e) =>
							vm.setFilter((f) => ({ ...f, keyword: e.target.value }))
						}
					/>
				</Field>
				<Field label="Status" className="w-36">
					<Select
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
				</Field>
			</LayerCard>

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
				<LayerCard padding="none" className="overflow-x-auto">
					<Table aria-label="Tags">
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Color</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{vm.visible.map((t) => (
								<TableRow key={t.id}>
									<TableCell>
										<EntityTag tag={t} />
									</TableCell>
									<TableCell className="font-mono text-xs text-basalt-muted-foreground">
										{t.color}
									</TableCell>
									<TableCell className="space-x-2 whitespace-nowrap text-right">
										<Button
											variant="outline"
											size="sm"
											aria-label={`Edit ${t.name}`}
											onClick={() => vm.setEditing(t)}
										>
											Edit
										</Button>
										{t.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												aria-label={`Archive ${t.name}`}
												onClick={() => void vm.archive(t.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
												aria-label={`Restore ${t.name}`}
												onClick={() => void vm.restore(t.id)}
											>
												Restore
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
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

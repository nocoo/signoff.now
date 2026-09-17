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
import { GitBranch } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { SelectControl as Select } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
import type { StatusFilter } from "@/models/entities";
import { useReposViewModel } from "@/viewmodels/useReposViewModel";
import { RepoDialog } from "./RepoDialog";

const PROVIDER_LABELS: Record<string, string> = {
	ado: "Azure DevOps",
	github: "GitHub",
};

export function ReposPage() {
	const vm = useReposViewModel();

	return (
		<div className="space-y-6">
			<PageHeader
				title="Repos"
				description="Azure DevOps repository bindings for local pipeline collection."
				actions={
					<>
						<p className="text-xs text-basalt-muted-foreground">
							{vm.visible.length} of {vm.items.length}
						</p>
						<Button onClick={() => vm.setCreating(true)}>Bind repo</Button>
					</>
				}
			/>
			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<LayerCard
				role="search"
				aria-label="Repos filters"
				className="flex flex-wrap items-end gap-3"
			>
				<Field label="Search" className="w-56">
					<Input
						value={vm.filter.keyword}
						placeholder="Org, project or name"
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
				<Field label="Provider" className="w-44">
					<Select
						value={vm.filter.provider ?? ""}
						onChange={(value) =>
							vm.setFilter((f) => ({
								...f,
								provider: value || null,
							}))
						}
					>
						<option value="">All providers</option>
						{vm.providers.map((p) => (
							<option key={p} value={p}>
								{PROVIDER_LABELS[p] ?? p}
							</option>
						))}
					</Select>
				</Field>
				<Field label="Collection" className="w-36">
					<Select
						value={
							vm.filter.enabled === null ? "" : vm.filter.enabled ? "yes" : "no"
						}
						onChange={(value) =>
							vm.setFilter((f) => ({
								...f,
								enabled: value === "" ? null : value === "yes",
							}))
						}
					>
						<option value="">Any</option>
						<option value="yes">Enabled</option>
						<option value="no">Disabled</option>
					</Select>
				</Field>
			</LayerCard>

			{vm.loading ? (
				<LayerCard className="space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</LayerCard>
			) : vm.visible.length === 0 ? (
				<LayerCard padding="none">
					<EmptyState
						icon={GitBranch}
						title={vm.items.length === 0 ? "No repos bound" : "No matches"}
						description={
							vm.items.length === 0
								? "Bind an ADO repository (org / project / name / GUIDs) so the local pipeline can collect."
								: "No repo matches the current filters."
						}
					/>
				</LayerCard>
			) : (
				<LayerCard padding="none" className="overflow-x-auto">
					<Table aria-label="Repos">
						<TableHeader>
							<TableRow>
								<TableHead>Org / Project</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Repo GUID</TableHead>
								<TableHead>Project GUID</TableHead>
								<TableHead>Collection</TableHead>
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{vm.visible.map((r) => (
								<TableRow key={r.id}>
									<TableCell>
										{r.org} / {r.project}
									</TableCell>
									<TableCell className="px-4 py-3 font-medium">
										{r.name}
									</TableCell>
									<TableCell className="px-4 py-3 font-mono text-xs text-basalt-muted-foreground">
										{r.externalId ?? "—"}
									</TableCell>
									<TableCell className="px-4 py-3 font-mono text-xs text-basalt-muted-foreground">
										{r.projectExternalId ?? "—"}
									</TableCell>
									<TableCell className="px-4 py-3 text-xs">
										{r.enabled ? (
											"Enabled"
										) : (
											<span className="text-basalt-muted-foreground">
												Disabled
											</span>
										)}
									</TableCell>
									<TableCell className="whitespace-nowrap text-right space-x-2">
										<Button
											variant="outline"
											size="sm"
											aria-label={`Edit ${r.name}`}
											onClick={() => vm.setEditing(r)}
										>
											Edit
										</Button>
										{r.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												aria-label={`Archive ${r.name}`}
												onClick={() => void vm.archive(r.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
												aria-label={`Restore ${r.name}`}
												onClick={() => void vm.restore(r.id)}
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

			<RepoDialog
				repo={vm.editing}
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

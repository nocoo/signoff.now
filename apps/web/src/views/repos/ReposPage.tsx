import { Button, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { GitBranch } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
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
			/>
			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<section className="flex flex-wrap items-end gap-3">
				<Field label="Search" className="w-56">
					{(id) => (
						<Input
							id={id}
							value={vm.filter.keyword}
							placeholder="Org, project or name"
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
				<Field label="Provider" className="w-44">
					{(id) => (
						<Select
							id={id}
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
					)}
				</Field>
				<Field label="Collection" className="w-36">
					{(id) => (
						<Select
							id={id}
							value={
								vm.filter.enabled === null
									? ""
									: vm.filter.enabled
										? "yes"
										: "no"
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
					)}
				</Field>
				<div className="ml-auto flex items-center gap-3 pb-0.5">
					<p className="text-xs text-basalt-muted-foreground">
						{vm.visible.length} of {vm.items.length}
					</p>
					<Button onClick={() => vm.setCreating(true)}>Bind repo</Button>
				</div>
			</section>

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
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-basalt-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Org / Project
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Name
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Repo GUID
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Project GUID
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Collection
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{vm.visible.map((r) => (
								<tr
									key={r.id}
									className="border-b border-basalt-border last:border-0 hover:bg-basalt-background/50"
								>
									<td className="px-4 py-3">
										{r.org} / {r.project}
									</td>
									<td className="px-4 py-3 font-medium">{r.name}</td>
									<td className="px-4 py-3 font-mono text-xs text-basalt-muted-foreground">
										{r.externalId ?? "—"}
									</td>
									<td className="px-4 py-3 font-mono text-xs text-basalt-muted-foreground">
										{r.projectExternalId ?? "—"}
									</td>
									<td className="px-4 py-3 text-xs">
										{r.enabled ? (
											"Enabled"
										) : (
											<span className="text-basalt-muted-foreground">
												Disabled
											</span>
										)}
									</td>
									<td className="px-4 py-3 text-right space-x-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => vm.setEditing(r)}
										>
											Edit
										</Button>
										{r.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												onClick={() => void vm.archive(r.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
												onClick={() => void vm.restore(r.id)}
											>
												Restore
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
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

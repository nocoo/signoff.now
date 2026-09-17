import { Button, Field } from "@nocoo/basalt";
import { GitBranch } from "lucide-react";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";

export function RepositoryFilters({ vm }: { vm: WorkbenchViewModel }) {
	return (
		<section aria-label="Repository scope" className="space-y-2">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1.5fr]">
				<Field label="Organization">
					<SelectControl
						value={vm.filter.organization}
						onChange={(organization) => vm.setFilter({ organization })}
					>
						<option value="">All organizations</option>
						{vm.organizations.map((organization) => (
							<option key={organization} value={organization}>
								{organization}
							</option>
						))}
					</SelectControl>
				</Field>
				<Field label="Project">
					<SelectControl
						value={vm.filter.projectId}
						onChange={(projectId) => vm.setFilter({ projectId })}
					>
						<option value="">All projects</option>
						{vm.projectOptions.map(({ project }) => (
							<option key={project.id} value={project.id}>
								{project.projectKey}
								{!vm.filter.organization ? ` · ${project.organization}` : ""}
							</option>
						))}
					</SelectControl>
				</Field>
				<div className="col-span-2 lg:col-span-1">
					<Field label="Repository">
						<SelectControl
							value={vm.selectedRepository?.key ?? ""}
							onChange={vm.selectRepository}
						>
							<option value="">All repositories</option>
							{vm.repositories.map((repository) => (
								<option key={repository.key} value={repository.key}>
									{repository.name}
									{!vm.filter.projectId
										? ` · ${repository.project.organization} / ${repository.project.projectKey}`
										: ""}
								</option>
							))}
						</SelectControl>
					</Field>
				</div>
			</div>
			{vm.repositories.length > 0 ? (
				<section
					aria-label="Repository statistics"
					className="flex gap-3 overflow-x-auto p-1"
				>
					{vm.repositories.map((repository) => {
						const selected = vm.selectedRepository?.key === repository.key;
						const { project, metrics } = repository;
						return (
							<Button
								key={repository.key}
								variant="outline"
								aria-pressed={selected}
								aria-label={`Filter repository ${repository.name} in ${project.organization} / ${project.projectKey}`}
								className={cn(
									"h-auto min-w-0 flex-[1_0_260px] flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left text-basalt-foreground hover:bg-basalt-primary/3 hover:text-basalt-foreground",
									selected &&
										"border-basalt-primary/40 bg-basalt-primary/5 hover:bg-basalt-primary/5",
								)}
								onClick={() => vm.selectRepository(repository.key)}
							>
								<span className="flex w-full items-center gap-2">
									<GitBranch
										className="h-4 w-4 shrink-0 text-basalt-muted-foreground"
										aria-hidden
									/>
									<span className="min-w-0 break-words font-semibold">
										{repository.name}
									</span>
									<span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
										{project.lastScannedAt === null
											? "Not scanned"
											: `${metrics.open.toLocaleString()} open`}
									</span>
								</span>
								<span className="text-[11px] font-normal text-basalt-muted-foreground">
									{project.organization} / {project.projectKey}
								</span>
								{project.lastScannedAt !== null ? (
									<span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-normal tabular-nums text-basalt-muted-foreground">
										<span>{metrics.attention} attention</span>
										<span>{metrics.running} running</span>
										<span>{metrics.ready} ready</span>
										<span>{metrics.draft} drafts</span>
									</span>
								) : null}
							</Button>
						);
					})}
				</section>
			) : null}
		</section>
	);
}

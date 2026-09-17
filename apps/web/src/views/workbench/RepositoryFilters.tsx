import { Field } from "@nocoo/basalt";
import { SelectControl } from "@/components/SelectControl";
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
		</section>
	);
}

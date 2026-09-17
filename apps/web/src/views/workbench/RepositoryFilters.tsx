import { Button, Field } from "@nocoo/basalt";
import {
	organizationUrl,
	type Project,
	projectUrl,
	repositoryUrl,
} from "@signoff/domain/workbench";
import { ExternalLink } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { SelectControl } from "@/components/SelectControl";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";

export function RepositoryFilters({ vm }: { vm: WorkbenchViewModel }) {
	const scopedProject = vm.projectOptions.find(
		({ project }) => project.id === vm.filter.projectId,
	)?.project;
	const organizationProject = vm.filter.organization
		? vm.projectOptions[0]?.project
		: undefined;
	const selectedRepository = vm.selectedRepository;
	return (
		<section aria-label="Repository scope" className="space-y-2">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1.5fr]">
				<ScopeField
					label="Organization"
					href={
						organizationProject
							? organizationUrl(organizationProject)
							: undefined
					}
				>
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
				</ScopeField>
				<ScopeField
					label="Project"
					href={scopedProject ? projectUrl(scopedProject) : undefined}
				>
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
				</ScopeField>
				<div className="col-span-2 lg:col-span-1">
					<ScopeField
						label="Repository"
						href={
							selectedRepository
								? repositoryUrl(
										selectedRepository.project,
										selectedRepository.name,
									)
								: undefined
						}
					>
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
					</ScopeField>
				</div>
			</div>
		</section>
	);
}

function ScopeField({
	label,
	href,
	children,
}: {
	label: string;
	href?: string;
	children: ReactNode;
}) {
	return (
		<div className="relative">
			<Field label={label}>{children}</Field>
			{href ? (
				<Button
					asChild
					variant="ghost"
					size="icon"
					className="absolute -top-0.5 right-0 h-5 w-5 text-basalt-muted-foreground"
				>
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={`Open selected ${label.toLowerCase()} (new tab)`}
						title={`Open selected ${label.toLowerCase()} (new tab)`}
					>
						<ExternalLink className="h-3 w-3" aria-hidden />
					</a>
				</Button>
			) : null}
		</div>
	);
}

export function RepositoryScopeLinks({
	project,
	repository,
	organizationOnly = false,
}: {
	project: Project;
	repository?: string;
	organizationOnly?: boolean;
}) {
	const links = [
		["organization", project.organization, organizationUrl(project)],
		...(!organizationOnly
			? [["project", project.projectKey, projectUrl(project)]]
			: []),
		...(repository
			? [["repository", repository, repositoryUrl(project, repository)]]
			: []),
	];
	return links.map(([kind, label, href], index) => (
		<Fragment key={kind}>
			{index > 0 ? <span aria-hidden> / </span> : null}
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Open ${kind} ${label} (new tab)`}
				title={`Open ${kind} ${label} (new tab)`}
				className="rounded-sm underline-offset-4 hover:text-basalt-primary hover:underline focus-visible:outline-2 focus-visible:outline-basalt-ring"
			>
				{label}
			</a>
		</Fragment>
	));
}

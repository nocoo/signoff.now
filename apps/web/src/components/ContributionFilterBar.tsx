import { Button, Field, Input, LayerCard, Switch } from "@nocoo/basalt";
import {
	MultiSelect,
	type MultiSelectOption,
} from "@nocoo/basalt/components/multi-select";
import type { ContributionFilters } from "@signoff/domain/insights";
import { RotateCcw } from "lucide-react";
import type { useInsightsViewModel } from "@/viewmodels/useInsightsViewModel";
import { AlertBanner } from "./AlertBanner";
import { EntityAvatar } from "./EntityAvatar";
import { SelectControl } from "./SelectControl";

/** Selected unavailable values remain visible; missing options never broaden a filter. */
function retainSelected(
	options: MultiSelectOption[],
	selected: string[],
): MultiSelectOption[] {
	const values = new Set(options.map((option) => option.value));
	return [
		...options,
		...selected
			.filter((value) => !values.has(value))
			.map((value) => ({
				value,
				label: "Unavailable selection",
				description: value,
			})),
	];
}

export function ContributionFilterBar({
	vm,
	withDates = true,
}: {
	vm: ReturnType<typeof useInsightsViewModel>;
	withDates?: boolean;
}) {
	const { filters, directory, setFilters } = vm;
	const activeMembers =
		directory?.members.filter(
			(member) =>
				member.archivedAt === null &&
				!directory.blockedContributorKeys.includes(`member:${member.id}`),
		) ?? [];
	const memberIds = new Set(activeMembers.map((member) => member.id));
	const contributors: MultiSelectOption[] = [
		...activeMembers.map((member) => ({
			value: `member:${member.id}`,
			label: member.name,
			description: "Followed member",
			leading: (
				<EntityAvatar
					name={member.name}
					avatarUrl={member.avatarUrl}
					size="sm"
				/>
			),
		})),
		...(directory?.identities ?? [])
			.filter(
				(identity) =>
					!directory?.blockedContributorKeys.includes(
						`identity:${identity.key}`,
					) &&
					(identity.memberId === null || !memberIds.has(identity.memberId)),
			)
			.map((identity) => ({
				value: `identity:${identity.key}`,
				label: identity.name,
				description: `${identity.organization} · ${identity.handle ?? identity.actorId}`,
				leading: (
					<EntityAvatar
						name={identity.name}
						avatarUrl={identity.avatarUrl}
						size="sm"
					/>
				),
			})),
	];
	const pickers: {
		label: string;
		field:
			| "projectIds"
			| "repositoryKeys"
			| "teamIds"
			| "tagIds"
			| "contributorKeys";
		options: MultiSelectOption[];
	}[] = [
		{
			label: "Projects",
			field: "projectIds",
			options: (directory?.projects ?? []).map((project) => ({
				value: project.id,
				label: `${project.organization} / ${project.projectKey}`,
				description: project.provider === "ado" ? "Azure DevOps" : "GitHub",
			})),
		},
		{
			label: "Repositories",
			field: "repositoryKeys",
			options: (directory?.repositories ?? [])
				.filter(
					(repository) =>
						!filters.projectIds.length ||
						filters.projectIds.includes(repository.projectId),
				)
				.map((repository) => ({
					value: repository.key,
					label: repository.name,
					description: directory?.projects.find(
						(project) => project.id === repository.projectId,
					)?.projectKey,
				})),
		},
		{
			label: "Teams",
			field: "teamIds",
			options: (directory?.teams ?? [])
				.filter((team) => team.archivedAt === null)
				.map((team) => ({
					value: team.id,
					label: team.name,
					leading: (
						<EntityAvatar
							name={team.name}
							avatarUrl={team.avatarUrl}
							size="sm"
						/>
					),
				})),
		},
		{
			label: "Members & authors",
			field: "contributorKeys",
			options: contributors,
		},
		{
			label: "Tags",
			field: "tagIds",
			options: (directory?.tags ?? [])
				.filter((tag) => tag.archivedAt === null)
				.map((tag) => ({ value: tag.id, label: tag.name })),
		},
	];
	return (
		<LayerCard
			role="search"
			aria-label="Contribution filters"
			className="space-y-3"
		>
			<div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-5">
				{pickers.map(({ label, field, options }) => (
					<Field key={field} label={label} className="min-w-0">
						<MultiSelect
							showChips={false}
							className="space-y-0 [&>button]:px-3 [&>button]:font-normal [&>button>svg]:opacity-50"
							label={label}
							placeholder={`All ${label.toLowerCase()}`}
							options={retainSelected(options, filters[field])}
							value={filters[field]}
							loading={vm.loading}
							onValueChange={(value) =>
								setFilters(
									field === "projectIds"
										? { projectIds: value, repositoryKeys: [] }
										: { [field]: value },
								)
							}
						/>
					</Field>
				))}
			</div>
			<div className="flex flex-wrap items-end gap-3 border-t border-basalt-border/60 pt-3">
				{withDates ? (
					<>
						<Field label="Created from (UTC)" className="w-40">
							<Input
								type="date"
								value={filters.from ?? ""}
								onChange={(event) => setFilters({ from: event.target.value })}
							/>
						</Field>
						<Field label="Through (UTC)" className="w-40">
							<Input
								type="date"
								value={filters.to ?? ""}
								onChange={(event) => setFilters({ to: event.target.value })}
							/>
						</Field>
					</>
				) : null}
				<Field label="Contributors" className="w-44">
					<SelectControl
						value={filters.audience}
						onChange={(value) =>
							setFilters({ audience: value as ContributionFilters["audience"] })
						}
					>
						<option value="all">All authors</option>
						<option value="followed">Followed members</option>
					</SelectControl>
				</Field>
				<Field label="PR states" className="w-48">
					<MultiSelect
						showChips={false}
						className="space-y-0 [&>button]:px-3 [&>button]:font-normal [&>button>svg]:opacity-50"
						label="PR states"
						placeholder="All states"
						options={[
							{ value: "open", label: "Open" },
							{ value: "merged", label: "Merged" },
							{ value: "closed", label: "Closed" },
						]}
						value={filters.states.length === 3 ? [] : filters.states}
						onValueChange={(values) =>
							setFilters({
								states: values.length
									? (values as ContributionFilters["states"])
									: ["closed", "merged", "open"],
							})
						}
					/>
				</Field>
				<div className="flex h-9 items-center gap-2">
					<Switch
						id={`contribution-drafts-${withDates ? "dates" : "all"}`}
						checked={filters.includeDraft}
						onCheckedChange={(includeDraft) => setFilters({ includeDraft })}
						size="sm"
					/>
					<label
						htmlFor={`contribution-drafts-${withDates ? "dates" : "all"}`}
						className="text-xs"
					>
						Include drafts
					</label>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={vm.resetFilters}
					className="ml-auto"
				>
					<RotateCcw className="h-3.5 w-3.5" aria-hidden />
					Reset
				</Button>
			</div>
			{vm.filterError ? (
				<AlertBanner variant="error">{vm.filterError}</AlertBanner>
			) : null}
			{vm.error ? (
				<AlertBanner variant="error">
					{vm.error}{" "}
					<Button
						variant="link"
						size="sm"
						onClick={() => void vm.reloadDirectory()}
					>
						Reload directory
					</Button>
				</AlertBanner>
			) : null}
		</LayerCard>
	);
}

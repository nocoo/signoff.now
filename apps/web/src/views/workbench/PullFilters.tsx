import { Button, Field, Input } from "@nocoo/basalt";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import { Search } from "lucide-react";
import { EntityAvatar } from "@/components/EntityAvatar";
import { SelectControl } from "@/components/SelectControl";
import type { PullFilter } from "@/models/workbench";
import type { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PullQuickFilters } from "./PullQuickFilters";

export function PullFilters({
	vm,
}: {
	vm: Pick<
		ReturnType<typeof useWorkbench>,
		"filter" | "setFilter" | "authors" | "metrics" | "pullsLoaded"
	>;
}) {
	return (
		<>
			<search
				aria-label="Filter pull requests"
				className="grid w-full grid-cols-2 items-start gap-3 xl:grid-cols-[minmax(180px,1.4fr)_170px_1.2fr]"
			>
				<Field label="Search PRs">
					<div className="relative">
						<Search
							className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2"
							aria-hidden
						/>
						<Input
							aria-label="Search PRs"
							className="pl-9"
							placeholder="Title, #number, author…"
							value={vm.filter.query}
							onChange={(event) => vm.setFilter({ query: event.target.value })}
						/>
					</div>
				</Field>
				<Field label="Draft">
					<SelectControl
						value={vm.filter.draft}
						onChange={(draft) =>
							vm.setFilter({ draft: draft as PullFilter["draft"] })
						}
					>
						<option value="exclude">Exclude drafts</option>
						<option value="include">Include drafts</option>
						<option value="only">Drafts only</option>
					</SelectControl>
				</Field>
				<div className="relative">
					<Field label="Authors">
						<MultiSelect
							label="Authors"
							placeholder="All authors"
							showChips={false}
							searchPlaceholder="Find authors…"
							value={vm.filter.authors}
							onValueChange={(authors) => vm.setFilter({ authors })}
							options={vm.authors.map((author) => ({
								value: author.id,
								label: author.name,
								description: vm.authors.some(
									(other) =>
										other.id !== author.id && other.name === author.name,
								)
									? author.id
									: undefined,
								leading: (
									<span aria-hidden>
										<EntityAvatar name={author.name} size="sm" />
									</span>
								),
							}))}
						/>
					</Field>
					{vm.filter.authors.length ? (
						<Button
							variant="link"
							size="sm"
							className="absolute top-0 right-0 h-5 p-0 text-[11px]"
							aria-label="Clear author filter"
							onClick={() => vm.setFilter({ authors: [] })}
						>
							Clear
						</Button>
					) : null}
				</div>
			</search>
			<PullQuickFilters vm={vm} />
		</>
	);
}

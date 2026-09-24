import type { Project } from "@signoff/domain/workbench";
import { SelectControl } from "@/components/SelectControl";
import {
	ownerLabel,
	type useDataOwnerViewModel,
} from "@/viewmodels/useDataOwnerViewModel";

/** Whose connector refreshes a live project; admins choose, others read. */
export function DataOwnerField({
	project,
	admin,
	owners,
}: {
	project: Project;
	admin: boolean;
	owners: ReturnType<typeof useDataOwnerViewModel>;
}) {
	if (project.source !== "cli") return null;
	const choices = [
		...new Set(
			[project.dataOwner, ...owners.candidates].filter(
				(value): value is string => Boolean(value),
			),
		),
	];
	return (
		<div className="flex flex-wrap items-center gap-2 text-xs text-basalt-muted-foreground">
			<span>Data owner</span>
			{admin ? (
				<SelectControl
					aria-label={`Data owner for ${project.name}`}
					className="h-8 w-56 text-xs"
					value={project.dataOwner ?? ""}
					disabled={owners.busy !== null}
					onChange={(value) => void owners.assign(project.id, value || null)}
				>
					<option value="">No data owner</option>
					{choices.map((principal) => (
						<option key={principal} value={principal}>
							{ownerLabel(principal)}
						</option>
					))}
				</SelectControl>
			) : (
				<span className="text-basalt-foreground">
					{ownerLabel(project.dataOwner)}
				</span>
			)}
		</div>
	);
}

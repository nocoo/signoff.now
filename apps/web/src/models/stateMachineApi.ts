import { type DataSource, publicSource } from "@signoff/domain/monitoring";
import {
	machinePageSchema,
	machinePreviewSchema,
	machineVersionSchema,
	machineWriteSchema,
} from "@signoff/domain/query";
import { revisionSchema } from "@signoff/domain/workbench";
import { apiFetch } from "@/lib/api";

export type MachineScope = {
	source: DataSource;
	projectId: string;
	repositoryId: string | null;
};
function path(scope: MachineScope, suffix = "", pullId?: string | null) {
	const query = new URLSearchParams({ source: publicSource(scope.source) });
	if (scope.repositoryId) query.set("repositoryId", scope.repositoryId);
	if (pullId) query.set("pullId", pullId);
	return `/api/state-machines/${encodeURIComponent(scope.projectId)}${suffix}?${query}`;
}
export async function loadMachine(
	scope: MachineScope,
	pullId: string | null,
	signal: AbortSignal,
) {
	return machinePageSchema.parse(
		await apiFetch(path(scope, "", pullId), { signal }),
	);
}
export type MachineWrite = ReturnType<typeof machineWriteSchema.parse>;
export async function previewMachine(
	scope: MachineScope,
	body: MachineWrite,
	pullId?: string | null,
) {
	return machinePreviewSchema.parse(
		await apiFetch(path(scope, "/preview", pullId), {
			method: "POST",
			body: JSON.stringify(machineWriteSchema.parse(body)),
		}),
	);
}
export async function saveMachine(scope: MachineScope, body: MachineWrite) {
	return revisionSchema.parse(
		await apiFetch(path(scope), {
			method: "PATCH",
			body: JSON.stringify(machineWriteSchema.parse(body)),
		}),
	);
}
export async function loadMachineVersion(
	scope: MachineScope,
	revision: number,
) {
	return machineVersionSchema.parse(
		await apiFetch(path(scope, `/versions/${revision}`)),
	);
}

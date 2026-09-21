import { type DataSource, publicSource } from "@signoff/domain/monitoring";
import { machinePageSchema, machineWriteSchema } from "@signoff/domain/query";
import { apiFetch } from "@/lib/api";
export type MachineScope = {
	source: DataSource;
	projectId: string;
	repositoryId: string | null;
};
export type MachineWrite = ReturnType<typeof machineWriteSchema.parse>;
function path(scope: MachineScope) {
	const q = new URLSearchParams({ source: publicSource(scope.source) });
	if (scope.repositoryId) q.set("repositoryId", scope.repositoryId);
	return `/api/state-machines/${encodeURIComponent(scope.projectId)}?${q}`;
}
export const loadMachine = async (scope: MachineScope, signal: AbortSignal) =>
	machinePageSchema.parse(await apiFetch(path(scope), { signal }));
export const saveMachine = async (scope: MachineScope, body: MachineWrite) =>
	machinePageSchema.parse(
		await apiFetch(path(scope), {
			method: "PUT",
			body: JSON.stringify(machineWriteSchema.parse(body)),
		}),
	);

import { type DataSource, publicSource } from "@signoff/domain/monitoring";
import {
	machineHistorySchema,
	machinePageSchema,
	machineWriteSchema,
} from "@signoff/domain/query";
import { apiFetch } from "@/lib/api";
import { loadPulls } from "./monitoringApi";
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

export async function loadMachinePulls(
	scope: MachineScope,
	filter: { search: string; watchedOnly: boolean; cursor: string | null },
	signal: AbortSignal,
) {
	const params = new URLSearchParams({
		source: publicSource(scope.source),
		projectId: scope.projectId,
		state: "all",
		draft: "include",
		q: filter.search,
		limit: "50",
	});
	if (scope.repositoryId) params.set("repositoryId", scope.repositoryId);
	if (filter.watchedOnly) params.set("watching", "true");
	if (filter.cursor) params.set("cursor", filter.cursor);
	const page = await loadPulls(params.toString(), signal);
	return {
		data: page.data.map((p) => ({
			id: p.id,
			number: p.number,
			title: p.title,
			watched: Boolean(p.observation?.active),
		})),
		nextCursor: page.page.nextCursor,
	};
}
export async function loadMachineHistory(
	scope: MachineScope,
	pullId: string,
	signal: AbortSignal,
) {
	const params = new URLSearchParams({
		source: publicSource(scope.source),
		pullId,
	});
	return machineHistorySchema.parse(
		await apiFetch(
			`/api/state-machines/${encodeURIComponent(scope.projectId)}/history?${params}`,
			{ signal },
		),
	);
}

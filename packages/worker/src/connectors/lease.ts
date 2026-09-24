import type { Context } from "hono";
import { MonitoringError } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";

/**
 * A connector may act only on jobs it leased, and only while its owner still
 * owns the project and belongs to the project's tenant. Reassigning the data
 * owner or removing the member therefore stops the old connector at its next
 * call, and the lease returns to the queue when it expires.
 */
export async function assertConnectorLease(
	c: Context<AppEnv>,
	jobId: string,
): Promise<void> {
	const caller = c.get("caller");
	if (caller?.kind !== "connector") return;
	const owned = await c.env.DB.prepare(
		`SELECT 1 AS ok FROM collection_jobs j JOIN projects p ON p.id=j.project_id
     WHERE j.id=? AND j.lease_connector_id=? AND p.data_owner=?
     AND EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id=p.tenant_id AND m.principal=p.data_owner)`,
	)
		.bind(jobId, caller.connectorId, caller.owner)
		.first();
	if (!owned)
		throw new MonitoringError(
			"LEASE_LOST",
			"This connector no longer holds the job; its project may have a new data owner",
			409,
		);
}

export const connectorOwner = (c: Context<AppEnv>) => {
	const caller = c.get("caller");
	return caller?.kind === "connector"
		? { id: caller.connectorId, owner: caller.owner }
		: undefined;
};

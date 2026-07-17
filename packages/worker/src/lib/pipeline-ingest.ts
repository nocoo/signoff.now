/**
 * Ingest persistence is not implemented yet.
 * Never report success / accepted counts — CLI must not treat data as durable.
 */

export type IngestGateResult =
	| { kind: "bad_request"; error: string }
	| { kind: "conflict"; currentVersion: number }
	| { kind: "not_implemented"; currentVersion: number };

export function gatePipelineIngest(
	body: Record<string, unknown> | null,
	currentVersion: number,
): IngestGateResult {
	if (!body) {
		return { kind: "bad_request", error: "Invalid payload" };
	}
	if (
		typeof body.pipelineConfigVersion !== "number" ||
		!Number.isInteger(body.pipelineConfigVersion)
	) {
		return {
			kind: "bad_request",
			error: "pipelineConfigVersion required (integer)",
		};
	}
	if (body.pipelineConfigVersion !== currentVersion) {
		return { kind: "conflict", currentVersion };
	}
	// Valid request, but Activity/Score writes are not implemented.
	return { kind: "not_implemented", currentVersion };
}

export function ingestNotImplementedBody(currentVersion: number) {
	return {
		error: "Not Implemented",
		message:
			"Activity/Score ingest is not implemented; nothing was written to D1.",
		pipelineConfigVersion: currentVersion,
	};
}

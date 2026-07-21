/**
 * Ingest gate for 05: auth (middleware) → payload size → zod → version → 501.
 * Never report success / accepted counts — CLI must not treat data as durable.
 * Full write path is 06.
 */

import { INGEST_MAX_PAYLOAD_BYTES, ingestBodySchema } from "@signoff/domain";

export type IngestGateResult =
	| { kind: "payload_too_large" }
	| { kind: "bad_request"; error: string }
	| { kind: "conflict"; currentVersion: number }
	| { kind: "not_implemented"; currentVersion: number };

/**
 * Stream-aware size check: use actual body byte length when available.
 * Content-Length alone is not trusted (may be missing or forged).
 */
export function checkPayloadSize(byteLength: number): boolean {
	return byteLength <= INGEST_MAX_PAYLOAD_BYTES;
}

export function gatePipelineIngest(
	body: unknown,
	currentVersion: number,
	opts?: { rawByteLength?: number },
): IngestGateResult {
	if (
		opts?.rawByteLength !== undefined &&
		!checkPayloadSize(opts.rawByteLength)
	) {
		return { kind: "payload_too_large" };
	}

	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return { kind: "bad_request", error: "Invalid payload" };
	}

	const parsed = ingestBodySchema.safeParse(body);
	if (!parsed.success) {
		const msg = parsed.error.issues
			.slice(0, 3)
			.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("; ");
		return {
			kind: "bad_request",
			error: msg || "Body failed ingestBodySchema",
		};
	}

	if (parsed.data.pipelineConfigVersion !== currentVersion) {
		return { kind: "conflict", currentVersion };
	}

	// Valid request, but Activity/Score writes are not implemented (05).
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

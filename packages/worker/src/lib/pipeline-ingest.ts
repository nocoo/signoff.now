/**
 * Ingest gate: payload size → zod → version → ok (write path is processIngestChunk).
 */

import {
	INGEST_MAX_PAYLOAD_BYTES,
	type IngestBody,
	ingestBodySchema,
} from "@signoff/domain";

export type IngestGateResult =
	| { kind: "payload_too_large" }
	| { kind: "bad_request"; error: string }
	| { kind: "conflict"; currentVersion: number }
	| { kind: "ok"; body: IngestBody; currentVersion: number };

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

	return {
		kind: "ok",
		body: parsed.data,
		currentVersion,
	};
}

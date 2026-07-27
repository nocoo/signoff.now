import { AdoError, type AdoErrorKind } from "../ado/client.ts";
import { ExitCode } from "../exit-codes.ts";
import { isPipelineClientError } from "../pipeline/client.ts";

/**
 * Map a thrown collect failure onto its exit code (07 §9.4).
 *
 * Without this every failure exits `RUNTIME`, and automation cannot tell "your
 * az login expired" from "the service is down, retry later" from "this is a
 * bug". Those need three different responses, so the `AdoError` taxonomy has to
 * survive to the process boundary.
 *
 * Two taxonomies reach here, not one. `PipelineClientError` is a plain object
 * literal, NOT an Error subclass — so an `instanceof` check alone would report a
 * Worker outage as a programming bug. Every failure the CLI can actually throw
 * has to be enumerated, not just the one that is easiest to type-narrow.
 */
export function exitCodeForError(e: unknown): number {
	if (isPipelineClientError(e)) {
		return pipelineStatusCode(e.status);
	}
	if (!(e instanceof AdoError)) {
		return ExitCode.RUNTIME;
	}
	const byKind: Record<AdoErrorKind, number> = {
		// Fix the environment: log in again, or get access granted.
		unauthenticated: ExitCode.ENV,
		forbidden: ExitCode.ENV,
		// Wait and retry: the remote is unwell, we are not wrong.
		rate_limited: ExitCode.SERVER,
		server: ExitCode.SERVER,
		// We asked for the wrong thing, or got back something we cannot read.
		not_found: ExitCode.CONTRACT,
		bad_request: ExitCode.CONTRACT,
		bad_response: ExitCode.CONTRACT,
		// Narrowing is the caller's job and it did not happen — a bug here.
		result_too_large: ExitCode.RUNTIME,
	};
	return byKind[e.kind];
}

/** Our own Worker's HTTP status, mapped on the same axis as ADO's. */
function pipelineStatusCode(status: number): number {
	if (status === 401 || status === 403) {
		return ExitCode.ENV;
	}
	if (status === 429 || status >= 500 || status === 0) {
		return ExitCode.SERVER;
	}
	return ExitCode.CONTRACT;
}

/**
 * A message an operator can act on.
 *
 * `String(e)` on a `PipelineClientError` renders `[object Object]`, which tells
 * nobody anything — and that is the shape our own Worker throws.
 */
export function describeError(e: unknown): string {
	if (isPipelineClientError(e)) {
		return e.message;
	}
	return e instanceof Error ? e.message : String(e);
}

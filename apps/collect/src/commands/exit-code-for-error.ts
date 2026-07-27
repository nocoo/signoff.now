import { AdoError, type AdoErrorKind } from "../ado/client.ts";
import { ExitCode } from "../exit-codes.ts";

/**
 * Map a thrown collect failure onto its exit code (07 §9.4).
 *
 * Without this every failure exits `RUNTIME`, and automation cannot tell "your
 * az login expired" from "the service is down, retry later" from "this is a
 * bug". Those need three different responses, so the `AdoError` taxonomy has to
 * survive to the process boundary.
 */
export function exitCodeForError(e: unknown): number {
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

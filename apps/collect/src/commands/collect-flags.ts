import { ExitCode } from "../exit-codes.ts";

export type CollectFlags = {
	repo?: string;
	since?: string;
	full?: boolean;
	wi?: boolean;
};

/**
 * Reject flag combinations that would clear `scores_stale` on a partial pass.
 *
 * Extracted from the CLI action so it is testable: these guards protect against
 * silent global score corruption, and a regression that removed one would leave
 * every other test green.
 *
 * The check runs before any network call — a bad combination should fail
 * instantly, not after a bootstrap round trip that might itself fail and mask
 * the real problem.
 */
export function validateCollectFlags(
	flags: CollectFlags,
): { ok: true } | { ok: false; code: number; error: string } {
	if (flags.full && flags.repo) {
		return {
			ok: false,
			code: ExitCode.CONTRACT,
			error:
				"--full recomputes every score, so it cannot be limited to one repo; run `--full` alone or drop `--full`",
		};
	}
	if (flags.full && flags.wi === false) {
		return {
			ok: false,
			code: ExitCode.CONTRACT,
			error:
				"--full cannot skip work items: their scores would stay stale while the flag says otherwise",
		};
	}
	return { ok: true };
}

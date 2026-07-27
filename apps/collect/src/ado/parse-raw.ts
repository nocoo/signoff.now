/**
 * One place where every raw ADO payload is validated (07 §8).
 *
 * The point is not the helper — it is that NO caller may reach for a bare
 * `.parse()` or an `as` cast. Those two shapes have caused the same defect
 * three times over:
 *
 *   - a bare `.parse()` throws `ZodError`, which exits RUNTIME, so a shape
 *     change at Azure DevOps reads as "signoff has a bug";
 *   - an `as` cast reads a drifted payload as an EMPTY one, so a window is
 *     silently skipped, the cursor advances past it, and nobody is told.
 *
 * The second is the worse of the two: it loses data with no signal at all.
 */

import { z } from "zod";
import { AdoError } from "./client.ts";

/** Parse a raw ADO payload, reporting a schema failure as a contract error. */
export function parseRaw<T>(
	schema: { parse: (v: unknown) => T },
	raw: unknown,
	what: string,
): T {
	try {
		return schema.parse(raw);
	} catch (e) {
		throw new AdoError("bad_response", `${what} failed schema — ${detail(e)}`);
	}
}

function detail(e: unknown): string {
	if (e && typeof e === "object" && "issues" in e) {
		const issues = (
			e as { issues: { path: (string | number)[]; message: string }[] }
		).issues;
		// An empty issue list would render as an empty string, which tells the
		// operator nothing at all.
		if (issues.length > 0) {
			return issues
				.slice(0, 3)
				.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
				.join("; ");
		}
	}
	return e instanceof Error ? e.message : "unknown";
}

/**
 * WIQL returns the matching ids. Reading this with an `as` cast turns a drifted
 * response into "no work items", which looks exactly like a quiet window — and
 * the cursor then advances past days that were never read.
 *
 * `workItems` is REQUIRED, not optional. ADO always sends the key (empty array
 * when nothing matches), so `.optional()` bought no compatibility — it only let
 * a renamed key validate as `{}` and reopen the exact silent-skip this schema
 * exists to close. A genuinely empty result still parses: `{workItems: []}`.
 */
export const wiqlResultSchema = z
	.object({
		workItems: z.array(z.object({ id: z.number() }).loose()),
	})
	.loose();

/**
 * The state list behind closure detection. 06 decides closure by state
 * CATEGORY, never by name, so an unreadable list must not quietly degrade to
 * "nothing is closed" — every work item would then look permanently open.
 *
 * `value` is required for the same reason as above.
 */
export const workItemStatesSchema = z
	.object({
		value: z.array(
			z
				.object({
					name: z.string().optional(),
					category: z.string().optional(),
				})
				.loose(),
		),
	})
	.loose();

/** Just enough of a work item to read one field off it. */
export const oldestItemSchema = z
	.object({
		fields: z.record(z.string(), z.unknown()),
	})
	.loose();

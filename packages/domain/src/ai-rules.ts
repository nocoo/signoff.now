import { z } from "zod";

export const COMMON_RULES = `Judge as the PR developer: what should I do now?
Build failure means Attention: a person must inspect it. Do not decide rerun versus repair.
A running or queued build normally means Running. Unfinished policies are not negative conclusions. Without enough signal to require action, choose Running.
Request external review only after builds succeed and remain unexpired. Waiting is exclusively for external reviewers, never author changes or ordinary pipeline waits.
PoP (Proof Of Presence) is the final step, after successful unexpired builds and completed reviews. If PoP is the only remaining gate, classify Ready for that final step; provider merge requirements still apply.
Explicit build expiry requiring a person means Attention. Never infer automatic reruns. isExpired is distinct from buildIsNotCurrent or an older target.
C9/C12/C13 and W2/W3/W7: a completed negative policy conclusion means Attention; merely queued/running does not. Other unfinished policies default to Running unless stronger evidence requires attention.
Warning requires a known issue with evidence it may automatically recover. Ready requires mergeability, sufficient valid checks, successful unexpired builds and passed applicable policies, except the PoP-only convention.
Respect all policy instructions, their priority, required/advisory flags and conflicting evidence. Do not invent business meaning from policy names.`;
export const WHITEBOARD_RULES =
	"Expired builds do not automatically rerun in this project. Explicit build expiry with no current replacement in progress means Attention. Build and review must finish before PoP.";
export function defaultProjectRules(id: string) {
	return id === "bfa5f3fb-8876-4770-be58-4690527be9fe" ? WHITEBOARD_RULES : "";
}
export const aiRulesSchema = z.object({
	common: z.object({ revision: z.number().int(), text: z.string() }),
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			revision: z.number().int(),
			text: z.string(),
		}),
	),
});
export type AiRules = z.infer<typeof aiRulesSchema>;
export const aiRuleWriteSchema = z
	.object({
		scope: z.string().min(1).max(240),
		revision: z.number().int().nonnegative(),
		text: z.string().max(12000),
	})
	.strict();

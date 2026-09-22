import { z } from "zod";

export const COMMON_RULES = `Judge as the PR developer: what should I do now?
Build failure means Attention: a person must inspect it. Do not decide rerun versus repair.
An actively running build normally means Running. Queued builds or automatic prerequisites awaiting execution mean Waiting. Unfinished policies are not negative conclusions. Without enough signal to require action, choose Running.
Review Needed means builds succeeded and remain unexpired, no more serious blocker exists, and only review requirements remain: minimum approvals excluding the author, required/path reviewers or review compliance. This includes already assigned reviewers with pending votes. A missing approval is not a build failure or an author change request. Treat an unsatisfied review/compliance policy as a review deficit unless votes or provider evidence explicitly require author changes or another non-review action. A rejected review-policy evaluation alone is not a reviewer rejection. Actual requested code changes remain Attention. Waiting is for non-review processes such as queued builds, never for review.
PoP (Proof Of Presence) is the final step, after successful unexpired builds and completed reviews. If PoP is the only remaining gate, classify Ready for that final step; provider merge requirements still apply.
Explicit build expiry requiring a person means Attention. Never infer automatic reruns. isExpired is distinct from buildIsNotCurrent or an older target.
Review-policy deficits follow Review Needed above, including a negative compliance evaluation caused only by missing approvals. For non-review policies C9/C12/C13 and W2/W3/W7, a completed negative conclusion means Attention; merely queued/running does not. Other unfinished policies mean Running or Waiting according to execution state, unless stronger evidence requires attention.
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

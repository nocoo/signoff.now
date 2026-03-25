/**
 * GhLink — clickable element that opens a GitHub URL externally.
 *
 * Always renders as a native `<button>`. Calls `trpc.external.openUrl`
 * on click (same pattern as the existing "Open on GitHub" button).
 *
 * Calls `e.stopPropagation()` so it can be used inside PrRow's
 * `<div role="button">` without triggering row selection.
 */

import { cn } from "@signoff/ui/utils";
import { trpc } from "../../../../lib/trpc";
import { useGitHubUrlContext } from "./GitHubUrlProvider";
import { buildGitHubUrl, type GitHubUrlTarget } from "./github-urls";

interface GhLinkProps {
	target: GitHubUrlTarget;
	children: React.ReactNode;
	className?: string;
}

export function GhLink({ target, children, className }: GhLinkProps) {
	const ctx = useGitHubUrlContext();
	const openUrlMutation = trpc.external.openUrl.useMutation();

	if (!ctx) {
		// No provider — render children as plain text (graceful degradation).
		return <span className={className}>{children}</span>;
	}

	const url = buildGitHubUrl(ctx, target);

	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				openUrlMutation.mutate({ url });
			}}
			onKeyDown={(e) => {
				// Prevent keyboard activation from bubbling to parent
				// role="button" containers (e.g. PrRow).
				if (e.key === "Enter" || e.key === " ") {
					e.stopPropagation();
				}
			}}
			title={url}
			className={cn("inline cursor-pointer hover:underline", className)}
		>
			{children}
		</button>
	);
}

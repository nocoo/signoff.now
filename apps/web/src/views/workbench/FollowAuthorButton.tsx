import { Button } from "@nocoo/basalt";
import { identityKey } from "@signoff/domain/insights";
import type { Project, PullRequest } from "@signoff/domain/workbench";
import { UserCheck, UserPlus } from "lucide-react";
import { useFollowAuthor } from "@/viewmodels/useFollowAuthor";

export function FollowAuthorButton({
	project,
	author,
}: {
	project: Project;
	author: PullRequest["author"];
}) {
	const key =
		author.id && author.id !== "unknown"
			? identityKey(project.provider, project.organization, author.id)
			: null;
	const vm = useFollowAuthor(project.source, key);
	return (
		<div className="flex flex-col items-start gap-1">
			<Button
				variant="outline"
				size="sm"
				loading={vm.loading || vm.busy}
				disabled={vm.followed || (!vm.available && !vm.error)}
				title={!key ? "Author identity is unavailable" : undefined}
				onClick={() =>
					void (vm.error && !vm.available ? vm.reload() : vm.follow())
				}
			>
				{vm.followed ? (
					<UserCheck className="h-3.5 w-3.5" aria-hidden />
				) : (
					<UserPlus className="h-3.5 w-3.5" aria-hidden />
				)}
				{vm.followed
					? "Followed"
					: vm.busy
						? "Following…"
						: vm.loading
							? "Loading author…"
							: vm.error && !vm.available
								? "Retry author"
								: vm.archived
									? "Restore follow"
									: "Follow author"}
			</Button>
			{vm.error ? (
				<span role="alert" className="text-xs text-basalt-destructive">
					{vm.error}
				</span>
			) : null}
		</div>
	);
}

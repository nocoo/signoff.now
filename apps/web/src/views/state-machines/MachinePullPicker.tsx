import { Button, Input } from "@nocoo/basalt";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import type { MachinePullOption } from "@signoff/domain/query";
import { Eye, GitPullRequest, LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { MachineScope } from "@/models/stateMachineApi";
import { useMachinePullPicker } from "@/viewmodels/useMachinePullPicker";

export function MachinePullPicker({
	scope,
	pullId,
	selectedPull,
	onChange,
	autoSelect = true,
}: {
	scope: MachineScope;
	pullId: string | null;
	selectedPull: MachinePullOption | null;
	onChange: (id: string, options?: { replace?: boolean }) => void;
	autoSelect?: boolean;
}) {
	const [search, setSearch] = useState("");
	const [watchedOnly, setWatchedOnly] = useState(true);
	const vm = useMachinePullPicker(scope, search, watchedOnly);
	const first = vm.items[0];
	useEffect(() => {
		if (autoSelect && !pullId && first) onChange(first.id, { replace: true });
	}, [autoSelect, pullId, first, onChange]);
	const current =
		selectedPull?.id === pullId
			? selectedPull
			: vm.items.find((pr) => pr.id === pullId);
	return (
		<div className="shrink-0 space-y-2 border-b border-basalt-border px-3 py-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<div className="machine-pull-search relative w-28 shrink-0">
					<Search
						size={13}
						className="absolute left-2.5 top-1/2 -translate-y-1/2 text-basalt-muted-foreground"
						aria-hidden
					/>
					<Input
						aria-label="Search cached PRs"
						placeholder="Find a PR…"
						className="h-8 pl-8 text-xs"
						value={search}
						maxLength={1000}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</div>
				<Select
					value={pullId ?? ""}
					onValueChange={onChange}
					onOpenChange={(open) => {
						if (open) void vm.reload();
					}}
				>
					<SelectTrigger
						aria-label="Trace pull request"
						className="h-8 w-0 min-w-0 flex-1 gap-2 px-2 text-xs [&>span]:truncate [&>svg]:shrink-0"
					>
						<SelectValue
							placeholder={watchedOnly ? "Select a watched PR" : "Select a PR"}
						>
							{current
								? `#${current.number} ${current.title}`
								: pullId
									? "Selected PR"
									: undefined}
						</SelectValue>
					</SelectTrigger>
					<SelectContent
						className="machine-pull-menu min-w-[min(24rem,calc(100vw-2rem))] max-w-[min(48rem,calc(100vw-2rem))]"
						onScrollCapture={(event) => {
							const viewport = event.target as HTMLElement;
							if (
								!vm.error &&
								viewport.scrollHeight -
									viewport.scrollTop -
									viewport.clientHeight <
									80
							)
								void vm.loadMore();
						}}
					>
						{vm.items.map((pr) => (
							<SelectItem
								key={pr.id}
								value={pr.id}
								className="min-h-9 [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1"
							>
								<span
									className="flex min-w-0 items-center gap-2"
									title={`#${pr.number} ${pr.title}`}
								>
									{pr.watched ? (
										<Eye
											size={13}
											className="shrink-0 text-teal-500"
											aria-hidden
										/>
									) : (
										<GitPullRequest
											size={13}
											className="shrink-0 text-basalt-muted-foreground"
											aria-hidden
										/>
									)}
									<span className="shrink-0 font-mono text-xs text-basalt-muted-foreground">
										#{pr.number}
									</span>
									<span className="truncate">{pr.title}</span>
								</span>
							</SelectItem>
						))}
						<div
							role="status"
							className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-basalt-muted-foreground"
						>
							{vm.loading ? (
								<>
									<LoaderCircle
										size={13}
										className="animate-spin"
										aria-hidden
									/>
									Loading PRs…
								</>
							) : vm.error ? (
								"Unable to load PRs"
							) : !vm.items.length ? (
								watchedOnly ? (
									"No watched PRs match. Turn off Watched to browse all."
								) : (
									"No matching PRs"
								)
							) : vm.hasMore ? (
								"Scroll for more PRs"
							) : (
								`${vm.items.length} PRs`
							)}
						</div>
					</SelectContent>
				</Select>
				<Button
					size="sm"
					variant={watchedOnly ? "secondary" : "ghost"}
					className="h-8 shrink-0 px-2 text-xs"
					aria-label="Watched"
					aria-pressed={watchedOnly}
					onClick={() => setWatchedOnly((value) => !value)}
				>
					<Eye
						size={14}
						className={watchedOnly ? "text-teal-500" : ""}
						aria-hidden
					/>
					<span className="machine-watched-label">Watched</span>
				</Button>
			</div>
			{vm.error ? (
				<div
					role="alert"
					className="flex items-center gap-2 text-xs text-basalt-destructive"
				>
					<span>{vm.error}</span>
					<Button size="sm" variant="ghost" onClick={() => void vm.loadMore()}>
						Retry PRs
					</Button>
				</div>
			) : null}
		</div>
	);
}

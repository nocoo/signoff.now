import { Badge, Button } from "@nocoo/basalt";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nocoo/basalt/components/popover";
import type { DataSource } from "@signoff/domain/insights";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useContributorProfile } from "@/viewmodels/useContributorProfile";
import { type EntityAvatarProps, EntityLabel } from "./EntityAvatar";

export function ContributorProfile({
	source,
	contributorKey,
	name,
	avatarUrl,
	size = "sm",
	secondary,
	className,
}: EntityAvatarProps & {
	source: DataSource;
	contributorKey: string;
	secondary?: string;
}) {
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const hover = useRef(false);
	const content = useRef<HTMLDivElement>(null);
	const vm = useContributorProfile(source, contributorKey, open);
	useEffect(() => () => clearTimeout(timer.current), []);
	const keepOpen = () => clearTimeout(timer.current);
	const closeLater = () => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (!content.current?.contains(document.activeElement)) setOpen(false);
		}, 250);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					className={`h-auto min-w-0 max-w-full justify-start px-1 py-0.5 text-left ${className ?? ""}`}
					aria-label={`View ${name}'s profile`}
					onPointerEnter={(event) => {
						if (event.pointerType !== "mouse") return;
						keepOpen();
						hover.current = true;
						timer.current = setTimeout(() => setOpen(true), 250);
					}}
					onPointerLeave={closeLater}
					onPointerDown={() => {
						hover.current = false;
					}}
					onKeyDown={() => {
						hover.current = false;
					}}
				>
					<EntityLabel
						className="min-w-0 flex-1"
						name={name}
						avatarUrl={avatarUrl}
						source={source}
						size={size}
						secondary={secondary}
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				ref={content}
				align="start"
				className="w-88 max-w-[calc(100vw-2rem)] space-y-3"
				aria-label={`${name}'s contributor profile`}
				onPointerEnter={keepOpen}
				onPointerLeave={closeLater}
				onOpenAutoFocus={(event) => {
					if (hover.current) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					if (hover.current) event.preventDefault();
				}}
			>
				<div className="flex items-start justify-between gap-2">
					<EntityLabel
						className="min-w-0 flex-1 items-start [&>span:last-child>span]:line-clamp-2 [&>span:last-child>span]:whitespace-normal [&>span:last-child>span]:[overflow-wrap:anywhere]"
						name={name}
						avatarUrl={avatarUrl}
						source={source}
						size="lg"
						secondary={secondary}
					/>
					{vm.data?.blocked || vm.data?.followed ? (
						<Badge variant="secondary" className="shrink-0">
							{vm.data.blocked ? "Hidden" : "Followed"}
						</Badge>
					) : null}
				</div>
				{vm.data ? (
					<>
						<p className="text-xs text-basalt-muted-foreground">
							Last 90 days · Created PRs · Including drafts
						</p>
						<dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
							{(
								[
									["Total", vm.data.totals.total],
									["Merged", vm.data.totals.merged],
									["Open", vm.data.totals.open],
									["Closed", vm.data.totals.closed],
									["Draft", vm.data.totals.draft],
									["Repos", vm.data.totals.repositories],
								] as const
							).map(([label, value]) => (
								<div key={label}>
									<dt className="text-basalt-muted-foreground">{label}</dt>
									<dd className="text-base font-semibold tabular-nums">
										{value}
									</dd>
								</div>
							))}
						</dl>
						<div className="grid grid-cols-[1.35fr_1fr_1fr] gap-1.5 border-t border-basalt-border pt-3">
							<Button
								asChild
								size="sm"
								variant="outline"
								className="min-w-0 px-2"
							>
								<Link
									to={`/insights?${new URLSearchParams({ source, contributor: contributorKey })}`}
								>
									Contributions
								</Link>
							</Button>
							<Button
								size="sm"
								className="min-w-0 px-2"
								variant="outline"
								disabled={vm.busy || (vm.data.blocked && !vm.data.followed)}
								onClick={() => void vm.setFollowed(!vm.data?.followed)}
							>
								{vm.data.followed ? "Unfollow" : "Follow"}
							</Button>
							<Button
								size="sm"
								className="min-w-0 px-2"
								variant="outline"
								disabled={vm.busy}
								onClick={() => void vm.setBlocked(!vm.data?.blocked)}
							>
								{vm.data.blocked ? "Unhide" : "Hide"}
							</Button>
						</div>
					</>
				) : vm.loading ? (
					<p role="status" className="text-xs text-basalt-muted-foreground">
						Loading cached statistics…
					</p>
				) : null}
				{vm.error ? (
					<p role="alert" className="text-xs text-basalt-destructive">
						{vm.error}{" "}
						<Button variant="link" size="sm" onClick={() => void vm.reload()}>
							Retry
						</Button>
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

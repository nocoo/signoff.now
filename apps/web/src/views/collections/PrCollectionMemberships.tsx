import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import type { DataSource } from "@signoff/domain/monitoring";
import { Layers3, Plus } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { cn } from "@/lib/utils";
import { changeMembers, collectionHref } from "@/models/prCollectionsApi";
import {
	useCollectionMutation,
	usePrCollections,
	usePrMemberships,
} from "@/viewmodels/usePrCollections";
import { CollectionIcon } from "./CollectionIdentity";

function useMemberships(source: DataSource, ids: string[]) {
	const catalog = usePrCollections(source),
		memberships = usePrMemberships(source, ids);
	const [target, setTarget] = useState<{ id: string; number: number } | null>(
		null,
	);
	const mutation = useCollectionMutation(async () => {
		await Promise.all([catalog.reload(), memberships.reload()]);
	});
	return { catalog, memberships, target, setTarget, mutation, source };
}
const MembershipContext = createContext<ReturnType<
	typeof useMemberships
> | null>(null);
export function PrCollectionMembershipProvider({
	source,
	ids,
	children,
}: {
	source: DataSource;
	ids: string[];
	children: ReactNode;
}) {
	const vm = useMemberships(source, ids);
	return (
		<MembershipContext value={vm}>
			{children}
			{vm.target ? <MembershipDialog vm={vm} /> : null}
		</MembershipContext>
	);
}
export function PrCollectionMarker({
	id,
	number,
}: {
	id: string;
	number: number;
}) {
	const vm = useContext(MembershipContext);
	if (!vm) return null;
	const ids = new Set(
		vm.memberships.data?.items
			.filter((m) => m.pullId === id)
			.map((m) => m.collectionId),
	);
	const collections = vm.catalog.data?.items.filter((c) => ids.has(c.id)) ?? [];
	const label =
		vm.catalog.error || vm.memberships.error
			? "Collection membership unavailable"
			: vm.catalog.loading || vm.memberships.loading
				? "Loading collections…"
				: collections.length
					? `Collections: ${collections.map((c) => c.name).join(", ")}`
					: "Add to a collection";
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"h-5 gap-1 px-1 text-[11px]",
						collections.length
							? "text-basalt-badge-purple"
							: "text-basalt-muted-foreground/60",
					)}
					aria-label={`Collections for PR #${number}`}
					onClick={() => vm.setTarget({ id, number })}
				>
					<Layers3 className="size-3.5" aria-hidden />
					{collections.length > 1 ? <span>{collections.length}</span> : null}
				</Button>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs text-xs">{label}</TooltipContent>
		</Tooltip>
	);
}
function MembershipDialog({ vm }: { vm: ReturnType<typeof useMemberships> }) {
	const [opener] = useState(() => document.activeElement);
	const { target, catalog, memberships, mutation, source } = vm;
	if (!target) return null;
	const ids = new Set(
		memberships.data?.items
			.filter((m) => m.pullId === target.id)
			.map((m) => m.collectionId),
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !mutation.busy) vm.setTarget(null);
			}}
		>
			<DialogContent
				size="lg"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (opener instanceof HTMLElement) opener.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>Collections for PR #{target.number}</DialogTitle>
					<DialogDescription>
						A PR can belong to several collections. Changes save immediately.
					</DialogDescription>
				</DialogHeader>
				{mutation.error || catalog.error || memberships.error ? (
					<AlertBanner variant="error">
						{mutation.error || catalog.error || memberships.error}
					</AlertBanner>
				) : null}
				<div className="max-h-80 space-y-1 overflow-y-auto">
					{catalog.data?.items.map((c) => (
						<div
							key={c.id}
							className="flex items-center gap-3 rounded-basalt-md p-2 hover:bg-basalt-muted/40"
						>
							<Checkbox
								aria-label={c.name}
								disabled={
									mutation.busy ||
									memberships.loading ||
									Boolean(memberships.error)
								}
								checked={ids.has(c.id)}
								onCheckedChange={(checked) =>
									void mutation.run(() =>
										changeMembers(
											source,
											c,
											[target.id],
											checked === true ? "add" : "remove",
										),
									)
								}
							/>
							<CollectionIcon collection={c} compact />
							<Link
								to={collectionHref(c)}
								className="min-w-0 flex-1 truncate text-xs hover:underline"
							>
								{c.name}
							</Link>
							<span className="text-[11px] tabular-nums text-basalt-muted-foreground">
								{c.counts.total} PRs
							</span>
						</div>
					))}
					{catalog.data?.items.length === 0 ? (
						<p className="py-6 text-center text-xs text-basalt-muted-foreground">
							Create your first collection to organize this PR.
						</p>
					) : null}
				</div>
				<div className="flex justify-between gap-2">
					<Button asChild size="sm" variant="ghost">
						<Link
							to={`/collections?source=${source === "cli" ? "live" : "sample"}`}
						>
							<Plus className="size-3.5" />
							Manage collections
						</Link>
					</Button>
					<Button
						size="sm"
						onClick={() => vm.setTarget(null)}
						disabled={mutation.busy}
					>
						Done
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

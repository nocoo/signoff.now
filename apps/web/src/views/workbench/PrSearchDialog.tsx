import {
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandPalette,
} from "@nocoo/basalt";
import type { PullQueryItem } from "@signoff/domain/query";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { loadPulls, queryProject } from "@/models/monitoringApi";
import { DEFAULT_PULL_FILTER, writePullFilter } from "@/models/workbench";
import { pullHref, withQuery } from "@/models/workspaceLocation";
import { LifecycleBadge } from "./WorkbenchStatus";

function matchScore(item: PullQueryItem, trimmedQuery: string): number {
	if (!trimmedQuery) return 0;
	const q = trimmedQuery.toLowerCase();
	const numberToken = q.startsWith("#") ? q.slice(1) : q;
	const numberText = String(item.number);
	if (numberToken && numberText === numberToken) return 4;
	const terms = q.split(/\s+/).filter(Boolean);
	const title = item.title.toLowerCase();
	if (
		(numberToken && numberText.startsWith(numberToken)) ||
		title.includes(q) ||
		(terms.length > 1 && terms.every((term) => title.includes(term)))
	)
		return 3;
	const summary = [
		item.sourceBranch,
		item.targetBranch,
		item.author.name,
		item.author.handle ?? "",
		item.repository.name,
	]
		.join(" ")
		.toLowerCase();
	if (terms.every((term) => summary.includes(term))) return 2;
	return 1;
}

function matchHint(item: PullQueryItem, trimmedQuery: string): string | null {
	if (!trimmedQuery) return null;
	const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
	const visible = [
		`#${item.number}`,
		item.title,
		item.project.organization,
		item.project.name,
		item.repository.name,
		item.author.name,
		item.sourceBranch,
		item.targetBranch,
	]
		.join(" ")
		.toLowerCase();
	const hidden = terms.filter((term) => !visible.includes(term));
	if (!hidden.length) return null;
	const hasAll = (text: string) => {
		const lower = text.toLowerCase();
		return hidden.every((term) => lower.includes(term));
	};
	const reviewer = item.reviewers.find((r) =>
		hasAll(`${r.name} ${r.handle ?? ""}`),
	);
	if (reviewer) return `Reviewer: ${reviewer.name}`;
	const label = item.labels.find((entry) => hasAll(entry));
	if (label) return `Label: ${label}`;
	const policy = item.policies.find((p) => hasAll(`${p.name} ${p.detail}`));
	if (policy) return `Check: ${policy.name}`;
	const build = item.builds.find((b) => hasAll(`${b.name} ${b.number}`));
	if (build) return `Build: ${build.name}`;
	const sha = [item.headSha, item.targetSha, item.evidence?.mergeSha].find(
		(candidate): candidate is string => Boolean(candidate && hasAll(candidate)),
	);
	if (sha) return `SHA: ${sha.slice(0, 8)}`;
	if (item.author.handle && hasAll(item.author.handle))
		return item.author.handle;
	return "Matched description or activity";
}

export function PrSearchDialog({
	open,
	onOpenChange,
	source,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	source: "cli" | "demo";
}) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [items, setItems] = useState<PullQueryItem[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const trimmed = query.trim();
		if (!trimmed) {
			setDebouncedQuery("");
			return;
		}
		const timer = setTimeout(() => setDebouncedQuery(trimmed), 150);
		return () => clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		const params = new URLSearchParams({
			source: source === "demo" ? "sample" : "live",
			state: "all",
			draft: "include",
			q: debouncedQuery,
			sort: "updated",
			direction: "desc",
			limit: "25",
		});
		loadPulls(params.toString(), controller.signal)
			.then((result) => {
				if (controller.signal.aborted) return;
				setItems(result.data);
				setTotal(result.page.total);
				setLoading(false);
			})
			.catch((err: unknown) => {
				if (controller.signal.aborted) return;
				if (err instanceof DOMException && err.name === "AbortError") return;
				setItems([]);
				setTotal(0);
				setError(
					err instanceof Error
						? err.message
						: "Unable to search cached pull requests",
				);
				setLoading(false);
			});
		return () => controller.abort();
	}, [open, source, debouncedQuery]);

	const ranked = useMemo(() => {
		if (!debouncedQuery) return items;
		return items
			.map((item, index) => ({
				item,
				index,
				score: matchScore(item, debouncedQuery),
			}))
			.sort((a, b) => b.score - a.score || a.index - b.index)
			.map((entry) => entry.item);
	}, [items, debouncedQuery]);

	const heading = debouncedQuery
		? `${total.toLocaleString()} cached PRs matched`
		: "Recent cached PRs";

	return (
		<CommandPalette
			open={open}
			onOpenChange={onOpenChange}
			shouldFilter={false}
		>
			<CommandInput
				aria-label="Search cached pull requests"
				placeholder="Search cached PRs by any word, #number, branch, description, author…"
				value={query}
				onValueChange={setQuery}
			/>
			<CommandList className="max-h-[24rem]">
				<CommandEmpty>
					{error
						? error
						: loading
							? "Searching cached pull requests…"
							: "No cached pull requests match your search."}
				</CommandEmpty>
				{ranked.length > 0 ? (
					<CommandGroup heading={heading}>
						{ranked.map((item) => {
							const hint = matchHint(item, debouncedQuery);
							return (
								<CommandItem
									key={item.id}
									value={item.id}
									onSelect={() => {
										onOpenChange(false);
										void navigate(pullHref(queryProject(item.project), item));
									}}
									className="flex flex-col items-stretch gap-1"
								>
									<div className="flex min-w-0 items-center gap-2">
										<LifecycleBadge
											pull={{
												state: item.state === "draft" ? "open" : item.state,
												draft: item.draft,
											}}
										/>
										<span className="shrink-0 font-mono text-xs tabular-nums text-basalt-muted-foreground">
											#{item.number}
										</span>
										<span className="min-w-0 flex-1 truncate font-medium">
											{item.title}
										</span>
									</div>
									<div className="truncate text-xs text-basalt-muted-foreground">
										{item.project.organization} / {item.project.name} /{" "}
										{item.repository.name} · {item.author.name} ·{" "}
										{item.sourceBranch} → {item.targetBranch}
										{hint ? ` · ${hint}` : ""}
									</div>
								</CommandItem>
							);
						})}
					</CommandGroup>
				) : null}
				{debouncedQuery && total > 0 ? (
					<CommandGroup heading="Actions">
						<CommandItem
							value={`view-all-${debouncedQuery}`}
							onSelect={() => {
								onOpenChange(false);
								void navigate(
									withQuery(
										"/prs",
										writePullFilter({
											...DEFAULT_PULL_FILTER,
											source,
											state: "all",
											draft: "include",
											query: debouncedQuery,
										}),
									),
								);
							}}
						>
							<ArrowRight aria-hidden className="mr-2 size-3.5 shrink-0" />
							<span>
								View all {total.toLocaleString()} matches in Pull requests
							</span>
						</CommandItem>
					</CommandGroup>
				) : null}
			</CommandList>
		</CommandPalette>
	);
}

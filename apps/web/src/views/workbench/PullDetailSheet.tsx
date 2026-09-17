import {
	Badge,
	Button,
	LayerCard,
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetTitle,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nocoo/basalt";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@nocoo/basalt/components/accordion";
import {
	approvalCount,
	type Build,
	type PullRequest,
	pullUrl,
} from "@signoff/domain/workbench";
import {
	ArrowRight,
	ExternalLink,
	GitBranch,
	GitPullRequest,
	MessageSquare,
	ScanLine,
	ShieldCheck,
	X,
} from "lucide-react";
import type { RefObject } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { duration, type PullRow, relativeTime } from "@/models/workbench";
import {
	CHECK_LABELS,
	CheckIcon,
	ReadinessBadge,
	StageBar,
	StageLegend,
} from "./WorkbenchStatus";

export function PullDetailSheet({
	row,
	missing,
	onClose,
	returnFocus,
	onScan,
	canScan,
	busy,
}: {
	row: PullRow | null;
	missing: boolean;
	onClose: () => void;
	returnFocus: RefObject<HTMLElement | null>;
	onScan: () => void;
	canScan: boolean;
	busy: boolean;
}) {
	return (
		<Sheet
			open={Boolean(row) || missing}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent
				className="w-full gap-0 p-0 sm:w-[740px] lg:w-[800px]"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const target = returnFocus.current?.isConnected
						? returnFocus.current
						: document.querySelector<HTMLElement>("main");
					target?.focus();
				}}
			>
				{row ? (
					<PullDetail
						key={row.pull.id}
						row={row}
						onScan={onScan}
						canScan={canScan}
						busy={busy}
					/>
				) : (
					<div className="p-6">
						<SheetTitle>Pull request unavailable</SheetTitle>
						<SheetDescription className="mt-2">
							This PR is no longer in the current snapshot.
						</SheetDescription>
						<EmptyState
							icon={GitPullRequest}
							title="PR not found"
							description="The project may have been removed or its source changed."
							action={
								<SheetClose asChild>
									<Button variant="outline">Back to pull requests</Button>
								</SheetClose>
							}
						/>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}

function PullDetail({
	row,
	onScan,
	canScan,
	busy,
}: {
	row: PullRow;
	onScan: () => void;
	canScan: boolean;
	busy: boolean;
}) {
	const { pull, project, readiness, progress } = row;
	return (
		<>
			<div className="space-y-4 border-b border-basalt-border px-5 py-5 sm:px-6">
				<div className="flex items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-sm text-basalt-muted-foreground">
							#{pull.number}
						</span>
						<ReadinessBadge readiness={readiness} />
						{project.source === "demo" ? (
							<Badge variant="secondary">Sample PR</Badge>
						) : null}
					</div>
					<SheetClose asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							aria-label="Close pull request details"
						>
							<X className="h-4 w-4" aria-hidden />
						</Button>
					</SheetClose>
				</div>
				<SheetTitle className="pr-4 text-xl leading-7">{pull.title}</SheetTitle>
				<SheetDescription>
					{project.name} / {pull.repository.name}{" "}
					<span className="mx-1" aria-hidden>
						·
					</span>{" "}
					{project.provider === "ado" ? "Azure DevOps" : "GitHub"}{" "}
					<span className="text-basalt-muted-foreground/80">
						· {project.organization}
					</span>
				</SheetDescription>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<EntityLabel
						name={pull.author.name}
						size="sm"
						className="text-xs"
						secondary={`Opened ${relativeTime(pull.createdAt)}`}
					/>
					<div className="flex items-center gap-2">
						{project.source !== "demo" ? (
							<Button variant="outline" size="sm" asChild>
								<a
									href={pullUrl(project, pull)}
									target="_blank"
									rel="noopener noreferrer"
								>
									View source
									<ExternalLink className="h-3.5 w-3.5" aria-hidden />
								</a>
							</Button>
						) : null}
						<Button
							variant="outline"
							size="sm"
							onClick={onScan}
							disabled={!canScan || busy}
						>
							<ScanLine className="h-3.5 w-3.5" aria-hidden />
							{busy ? "Scanning…" : "Scan project"}
						</Button>
					</div>
				</div>
				<div className="flex min-w-0 items-start gap-2 text-xs text-basalt-muted-foreground">
					<GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
					<code className="min-w-0 break-all">{pull.sourceBranch}</code>
					<ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
					<code className="shrink-0">{pull.targetBranch}</code>
				</div>
			</div>
			<Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
				<TabsList
					className="w-full shrink-0 justify-start px-5 sm:px-6"
					aria-label="Pull request details"
				>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="checks">
						Checks & builds{" "}
						<span className="ml-1.5 text-xs text-basalt-muted-foreground">
							{pull.policies.length + pull.builds.length}
						</span>
					</TabsTrigger>
					<TabsTrigger value="activity">Activity</TabsTrigger>
				</TabsList>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
					<TabsContent value="overview" className="space-y-5 pt-4">
						<LayerCard padding="none" outlined>
							<LayerCard.Header>
								<h3 className="text-xs font-medium uppercase tracking-wider">
									Next action
								</h3>
								<ReadinessBadge readiness={readiness} />
							</LayerCard.Header>
							<LayerCard.Well>
								<p className="text-base font-semibold leading-6">
									{readiness.action}
								</p>
								<div className="mt-3 flex items-center gap-2">
									<EntityAvatar name={readiness.owner} size="sm" />
									<span className="text-xs">{readiness.owner}</span>
									<span className="text-xs text-basalt-muted-foreground">
										· responsible
									</span>
								</div>
							</LayerCard.Well>
						</LayerCard>
						{readiness.issues.length ? (
							<section aria-label="Pending items">
								<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
									Pending items{" "}
									<Badge variant="secondary">{readiness.issues.length}</Badge>
								</h3>
								<div className="space-y-2">
									{readiness.issues.map((issue, index) => (
										<LayerCard
											key={`${issue.kind}-${issue.label}-${issue.action}-${issue.owner}`}
											padding="sm"
											className="flex items-start gap-3"
										>
											<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-basalt-muted text-[10px] font-medium text-basalt-muted-foreground">
												{index + 1}
											</span>
											<div className="min-w-0 flex-1">
												<p className="text-xs font-medium">{issue.label}</p>
												<p className="mt-1 text-xs leading-5 text-basalt-muted-foreground">
													{issue.action}
												</p>
												<p className="mt-1.5 text-[11px] text-basalt-muted-foreground">
													{issue.owner}
												</p>
											</div>
										</LayerCard>
									))}
								</div>
							</section>
						) : null}
						<section aria-label="Build progress">
							<div className="mb-3 flex items-center justify-between">
								<h3 className="text-sm font-semibold">Build progress</h3>
								<span className="text-xs text-basalt-muted-foreground">
									{progress.stagesTotal
										? `${progress.stagesPassed} / ${progress.stagesTotal} stages passed`
										: "No stages reported"}
								</span>
							</div>
							<div className="space-y-3">
								{pull.builds.length === 0 ? (
									<p className="text-xs text-basalt-muted-foreground">
										No build runs reported for this PR.
									</p>
								) : null}
								{pull.builds.map((build) => (
									<LayerCard key={build.id} padding="sm">
										<div className="mb-3 flex items-center justify-between gap-3">
											<span className="flex min-w-0 items-center gap-2 text-xs font-medium">
												<CheckIcon state={build.state} />
												{build.name}
												{!build.required ? (
													<Badge variant="secondary" className="text-[10px]">
														Advisory
													</Badge>
												) : null}
											</span>
											<span className="shrink-0 text-[11px] text-basalt-muted-foreground">
												{CHECK_LABELS[build.state]}
											</span>
										</div>
										<StageBar builds={[build]} />
									</LayerCard>
								))}
							</div>
							<div className="mt-3">
								<StageLegend />
							</div>
						</section>
						<Reviewers pull={pull} />
						<section>
							<h3 className="mb-3 text-sm font-semibold">About this change</h3>
							<p className="whitespace-pre-line text-sm leading-6 text-basalt-muted-foreground">
								{pull.description || "No description provided."}
							</p>
							<div className="mt-3 flex flex-wrap items-center gap-2">
								{pull.labels.map((label) => (
									<Badge key={label} variant="secondary">
										{label}
									</Badge>
								))}
							</div>
							<div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-basalt-muted-foreground">
								<span>
									{pull.filesChanged === null
										? "File count unavailable"
										: `${pull.filesChanged} files changed`}
								</span>
								<span className="font-mono text-basalt-heatmap-green-4">
									{pull.additions === null ? "" : `+${pull.additions}`}
								</span>
								<span className="font-mono text-basalt-destructive">
									{pull.deletions === null ? "" : `−${pull.deletions}`}
								</span>
								{pull.additions === null && pull.deletions === null ? (
									<span>Line changes unavailable</span>
								) : null}
								<span className="inline-flex items-center gap-1.5">
									<MessageSquare className="h-3.5 w-3.5" aria-hidden />
									{pull.comments === null
										? "Comments unavailable"
										: `${pull.comments} comments`}
								</span>
							</div>
						</section>
					</TabsContent>
					<TabsContent value="checks" className="space-y-6 pt-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="flex items-center gap-2 text-sm font-semibold">
								<ShieldCheck className="h-4 w-4" aria-hidden />
								{progress.checksPassed} / {progress.checksTotal} required checks
								passed
							</h3>
							<span className="text-xs text-basalt-muted-foreground">
								Observed {relativeTime(pull.observedAt)}
							</span>
						</div>
						{pull.coverage === "partial" ? (
							<AlertBanner variant="warning">
								Some check results are unavailable. Scan this project again to
								verify readiness.
								{pull.collectionIssues?.length ? (
									<ul className="mt-2 list-disc space-y-1 pl-4">
										{pull.collectionIssues.map((issue) => (
											<li key={issue} className="break-words">
												{issue}
											</li>
										))}
									</ul>
								) : null}
							</AlertBanner>
						) : null}
						<section aria-label="Policies">
							<h3 className="mb-3 text-sm font-semibold">
								Policies{" "}
								<span className="ml-1 text-basalt-muted-foreground">
									{pull.policies.length}
								</span>
							</h3>
							<LayerCard padding="none">
								<div className="divide-y divide-basalt-border">
									{pull.policies.map((policy) => (
										<div
											key={policy.id}
											className="flex items-start gap-3 p-3.5"
										>
											<CheckIcon state={policy.state} className="mt-0.5" />
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-xs font-medium">
														{policy.name}
													</span>
													<Badge
														variant={policy.required ? "outline" : "secondary"}
														className="text-[10px]"
													>
														{policy.required ? "Required" : "Advisory"}
													</Badge>
													<span className="text-[11px] text-basalt-muted-foreground">
														{CHECK_LABELS[policy.state]}
													</span>
												</div>
												<p className="mt-1 text-xs leading-5 text-basalt-muted-foreground">
													{policy.detail}
												</p>
												<p className="mt-1 text-[11px] text-basalt-muted-foreground">
													{policy.owner}
												</p>
											</div>
										</div>
									))}
								</div>
							</LayerCard>
						</section>
						<section aria-label="Build pipelines">
							<h3 className="mb-3 text-sm font-semibold">
								Builds & stages{" "}
								<span className="ml-1 text-basalt-muted-foreground">
									{pull.builds.length}
								</span>
							</h3>
							<Accordion
								type="multiple"
								defaultValue={pull.builds.map((build) => build.id)}
								className="space-y-3"
							>
								{pull.builds.map((build) => (
									<BuildPipeline
										key={build.id}
										build={build}
										href={
											project.source === "cli" && project.provider === "ado"
												? `https://dev.azure.com/${encodeURIComponent(project.organization)}/${encodeURIComponent(project.projectKey)}/_build/results?buildId=${build.number}`
												: undefined
										}
									/>
								))}
							</Accordion>
						</section>
					</TabsContent>
					<TabsContent value="activity" className="pt-4">
						<h3 className="mb-5 text-sm font-semibold">Recent activity</h3>
						{pull.activity.length === 0 ? (
							<p className="text-sm text-basalt-muted-foreground">
								No activity timeline in this snapshot. Open the PR in Azure
								DevOps for its full history.
							</p>
						) : null}
						<ol className="space-y-5">
							{[...pull.activity]
								.sort((a, b) => b.at - a.at)
								.map((event) => (
									<li key={event.id} className="flex items-start gap-3">
										<EntityAvatar name={event.actor} size="sm" />
										<div className="min-w-0 flex-1 border-b border-basalt-border pb-5">
											<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
												<span className="text-xs font-semibold">
													{event.actor}
												</span>
												<time
													dateTime={new Date(event.at * 1000).toISOString()}
													className="text-[11px] text-basalt-muted-foreground"
												>
													{relativeTime(event.at)}
												</time>
											</div>
											<p className="mt-2 text-sm">{event.title}</p>
											<p className="mt-1 text-xs leading-5 text-basalt-muted-foreground">
												{event.detail}
											</p>
										</div>
									</li>
								))}
						</ol>
					</TabsContent>
				</div>
			</Tabs>
			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-basalt-border px-5 py-3 text-[11px] text-basalt-muted-foreground sm:px-6">
				<span>
					{project.source === "demo"
						? "Sample data · approvals and failures require attention"
						: "Collected from the project source"}
				</span>
				<span>Last scanned {relativeTime(pull.observedAt)}</span>
			</div>
		</>
	);
}

function Reviewers({ pull }: { pull: PullRequest }) {
	const votes = {
		approved: { label: "Approved", variant: "success" },
		changes_requested: { label: "Changes requested", variant: "error" },
		pending: { label: "Pending", variant: "warning" },
		commented: { label: "Commented", variant: "secondary" },
	} as const;
	return (
		<section aria-label="Reviewers">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold">Reviewers</h3>
				<span className="text-xs text-basalt-muted-foreground">
					{approvalCount(pull)} / {pull.requiredApprovals} approvals
				</span>
			</div>
			<LayerCard padding="none">
				<div className="divide-y divide-basalt-border">
					{pull.reviewers.map((reviewer) => (
						<div
							key={reviewer.id}
							className="flex flex-wrap items-center justify-between gap-3 p-3.5"
						>
							<EntityLabel
								name={reviewer.name}
								size="sm"
								className="text-xs"
								secondary={
									reviewer.required ? "Required reviewer" : "Optional reviewer"
								}
							/>
							<Badge variant={votes[reviewer.vote].variant}>
								{votes[reviewer.vote].label}
							</Badge>
						</div>
					))}
				</div>
			</LayerCard>
		</section>
	);
}

function BuildPipeline({ build, href }: { build: Build; href?: string }) {
	return (
		<LayerCard padding="none">
			<AccordionItem value={build.id} className="border-0">
				<AccordionTrigger className="px-4 py-3.5 hover:no-underline">
					<span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
						<CheckIcon state={build.state} />
						<span className="text-sm font-semibold">{build.name}</span>
						<span className="font-mono text-[11px] text-basalt-muted-foreground">
							#{build.number}
						</span>
						<Badge
							variant={build.required ? "outline" : "secondary"}
							className="text-[10px]"
						>
							{build.required ? "Required" : "Advisory"}
						</Badge>
						<span className="ml-auto mr-2 text-xs font-normal text-basalt-muted-foreground">
							{CHECK_LABELS[build.state]}
						</span>
					</span>
				</AccordionTrigger>
				<AccordionContent className="pb-0">
					<div className="px-4 pb-4">
						<StageBar builds={[build]} />
						{build.stages.length === 0 ? (
							<p className="mt-2 text-xs text-basalt-muted-foreground">
								Stage details are unavailable for this run.
							</p>
						) : null}
						{href ? (
							<Button
								asChild
								variant="link"
								size="sm"
								className="mt-2 h-auto p-0 text-xs"
							>
								<a href={href} target="_blank" rel="noreferrer">
									Open build in Azure DevOps{" "}
									<ExternalLink className="h-3 w-3" aria-hidden />
								</a>
							</Button>
						) : null}
					</div>
					<ol className="divide-y divide-basalt-border border-t border-basalt-border">
						{build.stages.map((stage, index) => (
							<li key={stage.id} className="flex items-start gap-3 px-4 py-3">
								<span className="w-3 pt-0.5 text-[10px] tabular-nums text-basalt-muted-foreground">
									{index + 1}
								</span>
								<CheckIcon state={stage.state} className="mt-0.5" />
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-xs font-medium">{stage.name}</span>
										<span className="text-[11px] text-basalt-muted-foreground">
											{CHECK_LABELS[stage.state]}
										</span>
										{!stage.required ? (
											<Badge variant="secondary" className="text-[10px]">
												Advisory
											</Badge>
										) : null}
									</div>
									<p className="mt-1 text-xs leading-5 text-basalt-muted-foreground">
										{stage.detail}
									</p>
									<p className="mt-1 text-[11px] text-basalt-muted-foreground">
										{stage.owner}
									</p>
								</div>
								<span className="shrink-0 pt-0.5 font-mono text-[11px] text-basalt-muted-foreground">
									{duration(stage.durationSeconds)}
								</span>
							</li>
						))}
					</ol>
				</AccordionContent>
			</AccordionItem>
		</LayerCard>
	);
}

import { Button } from "@nocoo/basalt";
import type { MachinePage } from "@signoff/domain/query";
import { pullUrl, type StateMachine } from "@signoff/domain/workbench";
import {
	ArrowRight,
	Check,
	ExternalLink,
	History,
	LockKeyhole,
	RotateCcw,
	ShieldCheck,
} from "lucide-react";
import {
	MACHINE_COLORS,
	type MachineSelection,
} from "@/models/stateMachineGraph";
import { ReadinessSwatch } from "@/views/workbench/WorkbenchStatus";

type Evaluation = MachinePage["evaluations"][number];
export function EvidenceInspector({
	page,
	evaluation,
	selection,
	onSelectGate,
}: {
	page: MachinePage;
	evaluation?: Evaluation;
	selection: MachineSelection | null;
	onSelectGate: (id: string) => void;
}) {
	const pull = page.selectedPull;
	const gate = evaluation?.requirements.find(
		(g) => selection?.category === "gate" && g.id === selection.id,
	);
	const catalogGate = page.catalog.find(
		(g) => selection?.category === "gate" && g.id === selection.id,
	);
	const policies =
		pull?.policies.filter((p) => catalogGate?.sourceIds?.includes(p.id)) ?? [];
	const builds =
		pull?.builds.filter(
			(b) =>
				catalogGate?.definitionId &&
				b.definitionId === catalogGate.definitionId,
		) ?? [];
	return (
		<div className="space-y-4 text-xs">
			<div className="rounded-xl border border-basalt-primary/20 bg-basalt-primary/5 p-3">
				<ShieldCheck
					size={17}
					className="mb-2 text-basalt-primary"
					aria-hidden
				/>
				<p className="font-medium">Provider facts → rules → display</p>
				<p className="mt-1 leading-5 text-basalt-muted-foreground">
					Build, review, compliance and PoP can block at the same time.
					Completed and abandoned PRs stop automatic observation.
				</p>
			</div>
			{evaluation ? (
				<div className="space-y-2">
					<p className="font-semibold">
						#{evaluation.number} · {evaluation.readiness.label}
					</p>
					<p className="leading-5 text-basalt-muted-foreground">
						{evaluation.readiness.nextAction}
					</p>
					{pull ? (
						<a
							href={pullUrl(page.project, pull)}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 text-basalt-primary"
						>
							Open in provider
							<ExternalLink size={12} aria-hidden />
						</a>
					) : null}
				</div>
			) : (
				<p className="leading-5 text-basalt-muted-foreground">
					Select a cached PR to follow its evidence through the graph. Preview
					edited rules to see a new trace.
				</p>
			)}
			{catalogGate ? (
				<section
					className="space-y-2 rounded-xl border border-basalt-border p-3"
					aria-label="Gate evidence"
				>
					<h3 className="font-semibold">{gate?.label ?? catalogGate.name}</h3>
					<p>
						{gate?.state ?? "No evidence on this PR"} ·{" "}
						{gate
							? gate.required
								? "Required"
								: "Optional"
							: "Applicability not collected"}
					</p>
					<p className="break-words leading-5 text-basalt-muted-foreground">
						{catalogGate.detail}
					</p>
					{catalogGate.scope?.length ? (
						<div className="space-y-1">
							<p className="font-medium">Policy scope</p>
							{catalogGate.scope.map((scope) => (
								<p
									key={`${scope.repositoryId}:${scope.refName}:${scope.matchKind}`}
									className="break-all text-[11px] text-basalt-muted-foreground"
								>
									{scope.refName ?? "All branches"} ·{" "}
									{scope.matchKind ?? "Any match"} ·{" "}
									{scope.repositoryId ?? "All repositories"}
								</p>
							))}
						</div>
					) : null}
					{policies.map((policy) => (
						<div
							key={policy.id}
							className="space-y-1 border-t border-basalt-border pt-2"
						>
							<p className="font-medium">{policy.name}</p>
							<p className="text-basalt-muted-foreground">{policy.detail}</p>
							{policy.evidence ? (
								<dl className="space-y-1 text-[11px]">
									{Object.entries(policy.evidence)
										.filter(
											([name, value]) =>
												name !== "scope" &&
												value !== undefined &&
												value !== null,
										)
										.map(([name, value]) => (
											<div key={name} className="flex justify-between gap-3">
												<dt className="text-basalt-muted-foreground">{name}</dt>
												<dd className="break-all text-right font-mono">
													{String(value)}
												</dd>
											</div>
										))}
								</dl>
							) : (
								<p className="text-basalt-muted-foreground">
									Raw evidence arrives with the next checks refresh.
								</p>
							)}
						</div>
					))}
					{builds.map((build) => (
						<div
							key={build.id}
							className="space-y-1 border-t border-basalt-border pt-2"
						>
							<p className="font-medium">
								Build #{build.number} · {build.state}
							</p>
							<p className="break-all text-[11px] text-basalt-muted-foreground">
								{build.evidence?.sourceSha}
							</p>
							{build.stages.map((stage) => (
								<p key={stage.id} className="flex justify-between gap-2">
									<span>{stage.name}</span>
									<span>{stage.state}</span>
								</p>
							))}
						</div>
					))}
				</section>
			) : null}
			{evaluation ? (
				<section className="space-y-2" aria-label="Concurrent gate results">
					<h3 className="font-semibold">All gate results</h3>
					{evaluation.requirements.map((requirement) => (
						<Button
							variant="ghost"
							type="button"
							key={requirement.id}
							className="h-auto flex w-full items-center justify-between gap-2 rounded-lg border border-basalt-border px-3 py-2 text-left hover:bg-basalt-muted/40"
							onClick={() => onSelectGate(requirement.id)}
						>
							<span className="min-w-0 truncate" title={requirement.label}>
								{requirement.label}
							</span>
							<span className="shrink-0 text-[11px] text-basalt-muted-foreground">
								{requirement.state === "passed" ? (
									<Check
										size={13}
										className="inline text-emerald-600"
										aria-hidden
									/>
								) : null}{" "}
								{requirement.state}
							</span>
						</Button>
					))}
				</section>
			) : null}
		</div>
	);
}
export function MappingTrace({
	config,
	evaluation,
}: {
	config: StateMachine;
	evaluation?: Evaluation;
}) {
	if (!evaluation) return null;
	return (
		<details className="rounded-xl border border-basalt-border p-3 text-xs">
			<summary className="cursor-pointer font-medium">
				Evaluation trace · {evaluation.trace.length} mappings
			</summary>
			<ol className="mt-3 space-y-3">
				{evaluation.trace.map((trace) => (
					<li key={trace.ruleId} className="space-y-1">
						<div className="flex items-center gap-2">
							<span
								className={`h-1.5 w-1.5 shrink-0 rounded-full ${trace.selected ? "bg-basalt-primary" : "bg-basalt-muted-foreground/40"}`}
							/>
							<span>
								{config.mappings.find((r) => r.id === trace.ruleId)?.name ??
									trace.ruleId}
							</span>
						</div>
						<p className="pl-3.5 text-[11px] text-basalt-muted-foreground">
							{trace.selected
								? "Selected"
								: trace.matched
									? "Matched, later priority"
									: "Did not match"}{" "}
							· {trace.results.map((r) => (r ? "true" : "false")).join(" / ")}
						</p>
						{trace.guard ? (
							<p className="flex items-start gap-1 pl-3.5 text-[11px] text-amber-600 basalt-dark:text-amber-400">
								<LockKeyhole size={11} className="shrink-0" aria-hidden />
								{trace.guard}
							</p>
						) : null}
					</li>
				))}
			</ol>
		</details>
	);
}
export function MachineHistory({
	page,
	busy,
	onRestore,
}: {
	page: MachinePage;
	busy: boolean;
	onRestore: (revision: number) => void;
}) {
	return (
		<div className="space-y-5 text-xs">
			<section className="space-y-3">
				<h3 className="flex items-center gap-2 font-semibold">
					<History size={15} aria-hidden />
					Rule versions
				</h3>
				<p className="leading-5 text-basalt-muted-foreground">
					Load a version into your draft, preview its effect, then save a new
					revision.
				</p>
				{page.history.map((version) => (
					<div
						key={version.revision}
						className="flex items-center justify-between gap-2 rounded-xl border border-basalt-border p-3"
					>
						<div>
							<p className="font-medium">Revision {version.revision}</p>
							<time
								className="mt-1 block text-[10px] text-basalt-muted-foreground"
								dateTime={new Date(version.createdAt * 1000).toISOString()}
							>
								{new Date(version.createdAt * 1000).toLocaleString()}
							</time>
						</div>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Load revision ${version.revision} as draft`}
							disabled={busy}
							onClick={() => onRestore(version.revision)}
						>
							<RotateCcw size={14} aria-hidden />
						</Button>
					</div>
				))}
				{!page.history.length ? (
					<p className="text-basalt-muted-foreground">
						The first save creates version history.
					</p>
				) : null}
			</section>
			<section className="space-y-3">
				<h3 className="font-semibold">Observed PR transitions</h3>
				<p className="leading-5 text-basalt-muted-foreground">
					Last 30 collected changes for the selected PR, evaluated using the
					rules saved at that time. Earlier history is unavailable.
				</p>
				{page.transitions.map((event) => (
					<div
						key={event.id}
						className="rounded-xl border border-basalt-border p-3"
					>
						<p className="mb-2 text-[10px] text-basalt-muted-foreground">
							{new Date(event.at * 1000).toLocaleString()} · revision{" "}
							{event.ruleRevision}
						</p>
						<div className="flex flex-wrap items-center gap-1.5">
							<ReadinessSwatch color={event.from?.color ?? "gray"}>
								{event.from?.label ?? "First observation"}
							</ReadinessSwatch>
							<ArrowRight size={12} aria-hidden />
							<span style={{ color: MACHINE_COLORS[event.to.color ?? "gray"] }}>
								{event.to.label}
							</span>
						</div>
					</div>
				))}
				{!page.transitions.length ? (
					<p className="text-basalt-muted-foreground">
						No retained changes for this PR yet.
					</p>
				) : null}
			</section>
		</div>
	);
}

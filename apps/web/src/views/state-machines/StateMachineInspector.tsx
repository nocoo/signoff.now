import { Badge, Button } from "@nocoo/basalt";
import {
	CLASSIFICATION,
	JEV_MODEL,
	JEV_RUBRIC,
} from "@signoff/domain/ai-readiness";
import type {
	MachineHistory,
	MachinePage,
	PullQueryItem,
} from "@signoff/domain/query";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import type { MachineSelection } from "@/models/stateMachineGraph";
import { policyHref } from "@/models/workspaceLocation";
import { AiRulesEditor } from "@/views/settings/AiRulesEditor";

function Facts({ value }: { value: unknown }) {
	return (
		<pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-basalt-muted/30 p-2 font-mono text-[11px] leading-5">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}
export function MachineInspector({
	tab,
	page,
	pull,
	selection,
	history,
	historyError,
}: {
	tab: string;
	page: MachinePage;
	pull?: PullQueryItem;
	selection: MachineSelection | null;
	history: MachineHistory;
	historyError: string | null;
}) {
	if (tab === "rules")
		return (
			<div className="space-y-3">
				<p className="text-basalt-muted-foreground">
					{JEV_MODEL} · {JEV_RUBRIC}. Policy context and all evidence inform
					Jev. Drawing or moving nodes never changes a judgment.
				</p>
				<details>
					<summary className="cursor-pointer font-semibold">
						Classification definitions
					</summary>
					<dl className="space-y-3 py-3">
						{Object.entries(CLASSIFICATION).map(([key, value]) => (
							<div key={key}>
								<dt className="font-semibold capitalize">{key}</dt>
								<dd className="mt-1 text-basalt-muted-foreground">{value}</dd>
							</div>
						))}
					</dl>
				</details>
				<p className="text-basalt-muted-foreground">
					Conflict and non-main target Skipped are direct checks. Lifecycle
					remains a provider fact.
				</p>
				<AiRulesEditor />
			</div>
		);
	if (tab === "history")
		return (
			<div className="space-y-3">
				<p className="text-basalt-muted-foreground">
					Last 12 hours · up to 30 accepted evidence changes. These are provider
					observations, not historical Jev judgments.
				</p>
				{Boolean(historyError) && (
					<AlertBanner variant="error">{historyError}</AlertBanner>
				)}
				{!history.events.length && <p>No retained observations for this PR.</p>}
				{history.events.map((event) => (
					<details
						key={event.id}
						className="rounded-lg border border-basalt-border p-2"
					>
						<summary className="cursor-pointer">
							<time dateTime={new Date(event.at * 1000).toISOString()}>
								{new Date(event.at * 1000).toLocaleString()}
							</time>
							<span className="ml-2 text-basalt-muted-foreground">
								{event.from?.lifecycle ?? "Discovered"} → {event.to.lifecycle}
							</span>
						</summary>
						<Facts value={{ before: event.from, after: event.to }} />
					</details>
				))}
			</div>
		);
	const gate =
		selection?.category === "gate"
			? page.catalog.find(
					(g) => g.id === selection.id || selection.id.startsWith(`${g.id}:`),
				)
			: undefined;
	const requirements = gate
		? pull?.requirements.filter(
				(g) => g.id === gate.id || gate.sourceIds?.includes(g.id),
			)
		: pull?.requirements;
	const selectedPolicies = gate
		? pull?.policies.filter(
				(p) => p.id === gate.id || gate.sourceIds?.includes(p.id),
			)
		: pull?.policies;
	const instruction = gate
		? page.instructions.find(
				(i) => i.gateId === gate.id || gate.sourceIds?.includes(i.gateId),
			)
		: null;
	return (
		<div className="space-y-3">
			{!!selection && (
				<Badge variant="secondary">
					{selection.category} · {gate?.name ?? selection.id}
				</Badge>
			)}
			{!!gate && (
				<>
					<h3 className="font-semibold">
						{page.policyCodes[gate.id]} · {gate.name}
					</h3>
					<p className="text-basalt-muted-foreground">
						{instruction?.description || "No custom policy explanation."}
					</p>
					<Button asChild variant="outline" size="sm">
						<Link
							to={policyHref(
								page.project,
								page.repositories.find((r) => r.id === page.repositoryId),
							)}
						>
							Edit policy instructions
						</Link>
					</Button>
				</>
			)}
			{!pull ? (
				<p className="text-basalt-muted-foreground">
					Select a cached PR to trace its evidence. Watching is required for Jev
					classification.
				</p>
			) : (
				<>
					<h3 className="font-semibold">
						#{pull.number} · {pull.title}
					</h3>
					<p>
						{pull.readiness.previous
							? `Previous judgment: ${pull.readiness.previous.kind}. Current evaluation: ${pull.readiness.status}.`
							: `${pull.readiness.label} · ${pull.readiness.status}`}
					</p>
					<p className="text-basalt-muted-foreground">
						{pull.readiness.nextAction}
					</p>
					{Boolean(pull.readiness.error) && (
						<AlertBanner variant="error">{pull.readiness.error}</AlertBanner>
					)}
					<details open>
						<summary className="cursor-pointer font-semibold">
							Collection and validity
						</summary>
						<Facts
							value={{
								...pull.freshness,
								coverage: pull.content,
								headSha: pull.headSha,
								targetSha: pull.targetSha,
								mergeable: pull.mergeable,
							}}
						/>
					</details>
					<details open={Boolean(gate)}>
						<summary className="cursor-pointer font-semibold">
							Policy evidence
						</summary>
						<Facts value={{ requirements, evaluations: selectedPolicies }} />
					</details>
					<details>
						<summary className="cursor-pointer font-semibold">
							Builds and stages
						</summary>
						<Facts value={pull.builds} />
					</details>
					<details>
						<summary className="cursor-pointer font-semibold">
							Review votes
						</summary>
						<Facts value={pull.reviewers} />
					</details>
					<details>
						<summary className="cursor-pointer font-semibold">
							Persisted Jev result
						</summary>
						<Facts value={pull.readiness} />
					</details>
				</>
			)}
		</div>
	);
}

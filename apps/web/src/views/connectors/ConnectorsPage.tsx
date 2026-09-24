import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { Connector } from "@signoff/domain/connector";
import {
	CheckCircle2,
	Circle,
	CircleDot,
	Laptop,
	PlugZap,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { statusColor } from "@/models/collectorStatus";
import { connectorCommands } from "@/models/connectorApi";
import { relativeAge } from "@/models/freshness";
import { useSession } from "@/viewmodels/SessionProvider";
import {
	type GuideStep,
	useConnectorsViewModel,
} from "@/viewmodels/useConnectorsViewModel";
import { CommandLine } from "./CommandLine";

function Step({
	number,
	title,
	state,
	children,
}: {
	number: number;
	title: string;
	state: "done" | "current" | "todo";
	children: ReactNode;
}) {
	const Icon =
		state === "done" ? CheckCircle2 : state === "current" ? CircleDot : Circle;
	return (
		<li className="flex gap-3">
			<Icon
				aria-hidden
				strokeWidth={1.5}
				className={cn(
					"mt-0.5 h-5 w-5 shrink-0",
					state === "done"
						? statusColor("success")
						: state === "current"
							? "text-basalt-primary"
							: "text-basalt-muted-foreground",
				)}
			/>
			<div className="min-w-0 flex-1 space-y-2">
				<p className="flex items-center gap-2 text-sm font-medium">
					<span className="text-basalt-muted-foreground">{number}.</span>
					{title}
					{state === "done" ? (
						<Badge variant="secondary">Done</Badge>
					) : state === "current" ? (
						<Badge>Next</Badge>
					) : null}
				</p>
				<div className="space-y-2 text-sm text-basalt-muted-foreground">
					{children}
				</div>
			</div>
		</li>
	);
}

function ConnectorRow({
	connector,
	busy,
	onRevoke,
}: {
	connector: Connector;
	busy: boolean;
	onRevoke: () => void;
}) {
	const now = Math.floor(Date.now() / 1000);
	const az = connector.capabilities.az;
	return (
		<li className="flex flex-wrap items-center gap-3 py-2">
			<Laptop
				className="h-4 w-4 shrink-0 text-basalt-muted-foreground"
				aria-hidden
				strokeWidth={1.5}
			/>
			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-center gap-2 text-sm font-medium">
					{connector.name}
					{connector.revoked ? (
						<Badge variant="secondary">Revoked</Badge>
					) : connector.online ? (
						<Badge variant="secondary" className={statusColor("success")}>
							Online
						</Badge>
					) : (
						<Badge variant="secondary">Offline</Badge>
					)}
					{az && !connector.revoked ? (
						<Badge variant={az.loggedIn ? "secondary" : "destructive"}>
							{az.loggedIn
								? "az signed in"
								: az.installed
									? "az signed out"
									: "az missing"}
						</Badge>
					) : null}
				</p>
				<p className="truncate text-xs text-basalt-muted-foreground">
					{[
						connector.platform,
						connector.version && `v${connector.version}`,
						connector.lastSeenAt
							? `seen ${relativeAge(connector.lastSeenAt, now)}`
							: "never seen",
						connector.owner,
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
				{connector.message && !connector.revoked ? (
					<p className="truncate text-xs text-basalt-muted-foreground">
						{connector.message}
					</p>
				) : null}
			</div>
			{!connector.revoked ? (
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={onRevoke}
					aria-label={`Revoke ${connector.name}`}
				>
					<Trash2 className="h-4 w-4" aria-hidden strokeWidth={1.5} />
					Revoke
				</Button>
			) : null}
		</li>
	);
}

export function ConnectorsPage() {
	const vm = useConnectorsViewModel();
	const { state } = useSession();
	const session = state.status === "ready" ? state.session : null;
	const commands = connectorCommands(window.location.origin);
	const data = vm.list.data;
	const stepState = (step: GuideStep) =>
		vm.progress.done[step]
			? "done"
			: vm.progress.current === step
				? "current"
				: "todo";
	return (
		<div className="space-y-4">
			<PageHeader
				title="Connectors"
				description="A connector runs on your computer, uses your Azure CLI sign-in, and keeps this site's PR data fresh."
			/>
			{vm.error || vm.list.error ? (
				<AlertBanner variant="error">{vm.error ?? vm.list.error}</AlertBanner>
			) : null}
			{session?.local ? (
				<AlertBanner>
					This is a local session. Run <code>bun run dev:collector</code>{" "}
					instead; remote sign-in is for the deployed site.
				</AlertBanner>
			) : null}
			<LayerCard className="space-y-4">
				<h2 className="text-sm font-semibold">Set up a connector</h2>
				<ol className="space-y-5">
					<Step
						number={1}
						title="Install the SignOff CLI"
						state={stepState("install")}
					>
						<p>Requires Node.js 22 or later.</p>
						<CommandLine command={commands.install} />
					</Step>
					<Step
						number={2}
						title="Sign in from your terminal"
						state={stepState("login")}
					>
						<p>
							A browser window opens; approve with the same account you use
							here. The token is saved privately on your computer.
						</p>
						<CommandLine command={commands.login} />
					</Step>
					<Step
						number={3}
						title="Become the data owner of a project"
						state={stepState("owner")}
					>
						{data?.ownedProjects.length ? (
							<p>
								You refresh{" "}
								{data.ownedProjects.map((project) => project.name).join(", ")}.
							</p>
						) : (
							<p>
								An administrator chooses whose connector refreshes each project.
								Ask one to set you as data owner on the Projects page
								{session?.admin ? ", or do it yourself" : ""}.
							</p>
						)}
					</Step>
					<Step
						number={4}
						title="Sign in to Azure DevOps"
						state={stepState("az")}
					>
						<p>
							The connector reads Azure DevOps with your own Azure CLI login.
						</p>
						<CommandLine command={commands.azLogin} />
					</Step>
					<Step number={5} title="Start the connector" state={stepState("run")}>
						<p>
							Keep it running; this page turns green when its heartbeat arrives.
							Check it anytime with <code>{commands.status}</code>.
						</p>
						<CommandLine command={commands.daemon} />
					</Step>
				</ol>
			</LayerCard>
			<LayerCard className="space-y-2">
				<h2 className="text-sm font-semibold">
					{session?.admin ? "All connectors" : "Your connectors"}
				</h2>
				{!data ? (
					<Skeleton className="h-10 w-full" />
				) : data.connectors.length ? (
					<ul className="divide-y divide-basalt-border">
						{data.connectors.map((connector) => (
							<ConnectorRow
								key={connector.id}
								connector={connector}
								busy={vm.busy !== null}
								onRevoke={() => void vm.revoke(connector.id)}
							/>
						))}
					</ul>
				) : (
					<EmptyState
						compact
						icon={PlugZap}
						title="No connectors yet"
						description="Follow the steps above; your connector appears here after you sign in."
					/>
				)}
			</LayerCard>
		</div>
	);
}

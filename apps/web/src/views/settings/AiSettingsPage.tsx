import { Badge, Button, Field, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { AlertBanner } from "@/components/AlertBanner";
import { useAiSettingsViewModel } from "@/viewmodels/useAiSettingsViewModel";
export function AiSettingsPage() {
	const vm = useAiSettingsViewModel(),
		data = vm.settings.data;
	return (
		<div className="space-y-5">
			<PageHeader
				title="AI Settings"
				description="Jev classifies whether watched PRs need human intervention."
			/>
			{Boolean(vm.error || vm.settings.error) && (
				<AlertBanner variant="error">
					{vm.error || vm.settings.error}
				</AlertBanner>
			)}
			{Boolean(vm.notice) && (
				<p role="status" className="text-sm">
					{vm.notice}
				</p>
			)}
			<LayerCard className="max-w-3xl space-y-4">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="font-semibold">Jev API key</h2>
					<Badge variant="secondary">
						{data?.configured ? "Configured · ••••••••" : "Not configured"}
					</Badge>
					<Badge variant="outline">
						{data?.testState === "valid"
							? "Connection verified"
							: data?.testState === "error"
								? "Test failed"
								: "Not tested"}
					</Badge>
				</div>
				<p className="text-sm text-basalt-muted-foreground">
					Stored encrypted on the server. Saving a key enables automatic
					evaluation of watched PR facts, including PR and policy descriptions.
					On Track means no human action currently indicated; it never means
					permission to merge.
				</p>
				{data && !data.storageReady && (
					<AlertBanner variant="error">
						Server secret storage needs configuration before a key can be saved.
					</AlertBanner>
				)}
				<Field
					label={data?.configured ? "Replace API key" : "API key"}
					htmlFor="jev-key"
				>
					<Input
						id="jev-key"
						type="password"
						autoComplete="off"
						value={vm.key}
						onChange={(e) => vm.setKey(e.target.value)}
						placeholder="Enter your Jev API key"
						disabled={Boolean(vm.busy)}
					/>
				</Field>
				<div className="flex flex-wrap gap-2">
					<Button
						disabled={!vm.key.trim() || !data?.storageReady || Boolean(vm.busy)}
						onClick={() => void vm.act("save")}
					>
						{vm.busy === "save" ? "Saving…" : "Save key"}
					</Button>
					<Button
						variant="outline"
						disabled={!data?.configured || Boolean(vm.busy)}
						onClick={() => void vm.act("test")}
					>
						{vm.busy === "test" ? "Testing…" : "Test connection"}
					</Button>
					<Button
						variant="outline"
						disabled={!data?.configured || Boolean(vm.busy)}
						onClick={() => void vm.act("clear")}
					>
						Clear key
					</Button>
					<Button
						variant="ghost"
						disabled={Boolean(vm.busy) || !data}
						onClick={() => void vm.act("retry")}
					>
						Retry failed evaluations
					</Button>
				</div>
				{data?.testError !== null && (
					<p className="text-sm text-basalt-destructive">{data?.testError}</p>
				)}
				<p className="text-xs text-basalt-muted-foreground">
					Model: {data?.model ?? "—"} · Rubric: {data?.rubric ?? "—"}
					{data?.testedAt
						? ` · Last tested: ${new Date(data.testedAt).toLocaleString()}`
						: ""}
				</p>
				<p className="text-xs text-basalt-muted-foreground">
					Connection tests use synthetic data and do not reclassify PRs. Changed
					facts or policy instructions automatically queue a new evaluation;
					unchanged facts reuse the saved result. Confidence describes the
					model's distribution, not accuracy.
				</p>
			</LayerCard>
		</div>
	);
}

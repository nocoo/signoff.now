import { Badge, Button, Field, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { Settings2, X } from "lucide-react";
import { useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import {
	DEFAULT_ACTIVITY_WEIGHTS,
	normalizeSuffixInput,
	type SettingsFormState,
	WEIGHT_LABELS,
} from "@/models/settings";
import { useSettingsViewModel } from "@/viewmodels/useSettingsViewModel";

function SettingsSkeleton() {
	return (
		<div className="space-y-6">
			<PageHeader
				title="Settings"
				description="Timezone, identity matching, and activity weights."
			/>
			<LayerCard className="space-y-3">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-9 w-full max-w-md" />
			</LayerCard>
		</div>
	);
}

export function SettingsPage() {
	const vm = useSettingsViewModel();
	const [suffixDraft, setSuffixDraft] = useState("");

	if (vm.loading) {
		return <SettingsSkeleton />;
	}

	if (vm.error && (!vm.form || !vm.settings)) {
		return (
			<div className="space-y-6">
				<PageHeader
					title="Settings"
					description="Timezone, identity matching, and activity weights."
				/>
				<AlertBanner variant="error">{vm.error}</AlertBanner>
				<LayerCard padding="none">
					<EmptyState
						icon={Settings2}
						title="Unable to load settings"
						description="Your workspace settings are temporarily unavailable. Try loading them again."
						action={
							<Button variant="outline" onClick={() => void vm.reload()}>
								Retry
							</Button>
						}
					/>
				</LayerCard>
			</div>
		);
	}

	if (!vm.form || !vm.settings) {
		return (
			<div className="space-y-6">
				<PageHeader
					title="Settings"
					description="Timezone, identity matching, and activity weights."
				/>
				<LayerCard padding="none">
					<EmptyState
						icon={Settings2}
						title="No settings loaded"
						description="Reload to retrieve your workspace settings."
						action={
							<Button variant="outline" onClick={() => void vm.reload()}>
								Reload settings
							</Button>
						}
					/>
				</LayerCard>
			</div>
		);
	}

	const form = vm.form;
	const patch = (partial: Partial<SettingsFormState>) => {
		vm.setForm({ ...form, ...partial });
	};

	const addSuffix = () => {
		const s = normalizeSuffixInput(suffixDraft);
		if (!s || form.emailSuffixes.includes(s)) {
			return;
		}
		patch({ emailSuffixes: [...form.emailSuffixes, s] });
		setSuffixDraft("");
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title="Settings"
				description="Timezone, identity matching, and activity weights."
				actions={
					<Button
						disabled={!vm.dirty || !!vm.validationError || vm.saving}
						onClick={() => void vm.save()}
					>
						{vm.saving ? "Saving…" : "Save changes"}
					</Button>
				}
			/>

			{vm.settings.scoresStale ? (
				<AlertBanner variant="warning">
					<strong>Scores may be stale.</strong>{" "}
					{vm.settings.scoresStaleReason ?? "Configuration changed."} Run a full
					rematch on a machine with az access.
				</AlertBanner>
			) : null}

			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}
			{vm.toast ? <AlertBanner variant="info">{vm.toast}</AlertBanner> : null}
			{vm.dirty && vm.validationError ? (
				<AlertBanner variant="warning">{vm.validationError}</AlertBanner>
			) : null}

			<LayerCard padding="none">
				<LayerCard.Header>Timezone</LayerCard.Header>
				<LayerCard.Body className="space-y-3">
					<Field label="IANA timezone" className="max-w-md">
						<Input
							value={form.timezone}
							onChange={(e) => patch({ timezone: e.target.value })}
						/>
					</Field>
				</LayerCard.Body>
			</LayerCard>

			<LayerCard padding="none">
				<LayerCard.Header>Email suffixes</LayerCard.Header>
				<LayerCard.Body className="space-y-3">
					<p className="text-xs text-basalt-muted-foreground">
						Identity match: <code>alias@suffix</code> against ADO uniqueName.
					</p>
					<div className="flex flex-wrap gap-2">
						{form.emailSuffixes.map((s) => (
							<Badge key={s} variant="secondary" className="gap-2">
								{s}
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="h-5 w-5"
									aria-label={`Remove ${s}`}
									onClick={() =>
										patch({
											emailSuffixes: form.emailSuffixes.filter((x) => x !== s),
										})
									}
								>
									<X className="h-3 w-3" strokeWidth={1.5} aria-hidden />
								</Button>
							</Badge>
						))}
					</div>
					<div className="flex max-w-md gap-2">
						<Input
							aria-label="Email suffix"
							placeholder="example.com"
							value={suffixDraft}
							onChange={(e) => setSuffixDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addSuffix();
								}
							}}
						/>
						<Button type="button" variant="secondary" onClick={addSuffix}>
							Add
						</Button>
					</div>
				</LayerCard.Body>
			</LayerCard>

			<LayerCard padding="none">
				<LayerCard.Header className="flex items-center justify-between gap-2">
					<span>Activity weights</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							patch({ activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS } })
						}
					>
						Reset defaults
					</Button>
				</LayerCard.Header>
				<LayerCard.Well className="overflow-x-auto">
					<Table aria-label="Activity weights">
						<TableHeader>
							<TableRow>
								<TableHead>Type</TableHead>
								<TableHead>Weight</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{Object.keys(DEFAULT_ACTIVITY_WEIGHTS).map((key) => (
								<TableRow key={key}>
									<TableCell>
										{WEIGHT_LABELS[key] ?? key}
										<span className="ml-2 text-xs text-basalt-muted-foreground">
											{key}
										</span>
									</TableCell>
									<TableCell>
										<Input
											aria-label={`${WEIGHT_LABELS[key] ?? key} weight`}
											aria-invalid={
												!Number.isInteger(form.activityWeights[key]) ||
												(form.activityWeights[key] ?? 0) < 0
											}
											type="number"
											className="w-24"
											value={form.activityWeights[key] ?? 0}
											onChange={(e) =>
												patch({
													activityWeights: {
														...form.activityWeights,
														[key]: Number(e.target.value),
													},
												})
											}
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</LayerCard.Well>
			</LayerCard>

			<LayerCard padding="none">
				<LayerCard.Header>Pipeline status</LayerCard.Header>
				<LayerCard.Body className="space-y-2 text-sm">
					<p>
						Config version:{" "}
						<strong className="font-display">
							{vm.settings.pipelineConfigVersion}
						</strong>
					</p>
					<p>
						Stale:{" "}
						<strong>
							{vm.settings.scoresStale ? (
								<span className="text-basalt-warning">yes</span>
							) : (
								<span className="text-basalt-success">no</span>
							)}
						</strong>
					</p>
				</LayerCard.Body>
			</LayerCard>
		</div>
	);
}

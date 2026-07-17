import { useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
			<div className="space-y-2">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-4 w-72" />
			</div>
			<div className="rounded-[var(--radius-card)] bg-secondary p-5 space-y-3">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-9 w-full max-w-md" />
			</div>
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
			<div className="space-y-4">
				<PageHeader
					title="Settings"
					description="Timezone, email suffixes, and activity weights."
				/>
				<AlertBanner variant="error">{vm.error}</AlertBanner>
				<p className="text-sm text-muted-foreground">
					Is the Worker running on :37042? Try{" "}
					<code className="rounded bg-secondary px-1">bun run dev:all</code>.
				</p>
				<Button variant="secondary" onClick={() => void vm.reload()}>
					Retry
				</Button>
			</div>
		);
	}

	if (!vm.form || !vm.settings) {
		return <p className="text-sm text-muted-foreground">No settings loaded.</p>;
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
				description="Business configuration drives identity matching and scoring. Changes bump pipeline config version and may require full rematch."
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

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
				<h2 className="font-display text-base font-semibold">Timezone</h2>
				<div className="max-w-md space-y-2">
					<Label htmlFor="tz">IANA timezone</Label>
					<Input
						id="tz"
						value={form.timezone}
						onChange={(e) => patch({ timezone: e.target.value })}
					/>
				</div>
			</section>

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
				<h2 className="font-display text-base font-semibold">Email suffixes</h2>
				<p className="text-xs text-muted-foreground">
					Identity match: <code>alias@suffix</code> against ADO uniqueName.
				</p>
				<div className="flex flex-wrap gap-2">
					{form.emailSuffixes.map((s) => (
						<Badge key={s} variant="secondary" className="gap-2">
							{s}
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground"
								aria-label={`Remove ${s}`}
								onClick={() =>
									patch({
										emailSuffixes: form.emailSuffixes.filter((x) => x !== s),
									})
								}
							>
								×
							</button>
						</Badge>
					))}
				</div>
				<div className="flex max-w-md gap-2">
					<Input
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
			</section>

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
				<div className="flex items-center justify-between gap-2">
					<h2 className="font-display text-base font-semibold">
						Activity weights
					</h2>
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
				</div>
				<div className="overflow-x-auto rounded-[var(--radius-widget)] border border-border">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">
									Type
								</th>
								<th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">
									Weight
								</th>
							</tr>
						</thead>
						<tbody>
							{Object.keys(DEFAULT_ACTIVITY_WEIGHTS).map((key) => (
								<tr
									key={key}
									className="border-b border-border last:border-0 hover:bg-background/50"
								>
									<td className="px-3 py-2">
										{WEIGHT_LABELS[key] ?? key}
										<span className="ml-2 text-xs text-muted-foreground">
											{key}
										</span>
									</td>
									<td className="px-3 py-2">
										<Input
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
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 text-sm space-y-2">
				<h2 className="font-display font-semibold">Pipeline status</h2>
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
							<span className="text-warning">yes</span>
						) : (
							<span className="text-success">no</span>
						)}
					</strong>
				</p>
			</section>

			<div className="flex justify-end gap-2 sm:hidden">
				<Button
					disabled={!vm.dirty || !!vm.validationError || vm.saving}
					onClick={() => void vm.save()}
				>
					{vm.saving ? "Saving…" : "Save changes"}
				</Button>
			</div>
		</div>
	);
}

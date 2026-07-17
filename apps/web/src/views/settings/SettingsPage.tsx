import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	DEFAULT_ACTIVITY_WEIGHTS,
	normalizeSuffixInput,
	type SettingsFormState,
	WEIGHT_LABELS,
} from "@/models/settings";
import { useSettingsViewModel } from "@/viewmodels/useSettingsViewModel";

export function SettingsPage() {
	const vm = useSettingsViewModel();
	const [suffixDraft, setSuffixDraft] = useState("");

	if (vm.loading) {
		return <p className="text-sm text-muted-foreground">Loading settings…</p>;
	}

	if (vm.error && (!vm.form || !vm.settings)) {
		return (
			<div className="space-y-3">
				<p className="text-sm text-destructive">{vm.error}</p>
				<p className="text-sm text-muted-foreground">
					Is the Worker running on :37042? Try <code>bun run dev:all</code>.
				</p>
				<button
					type="button"
					className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm"
					onClick={() => void vm.reload()}
				>
					Retry
				</button>
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
		<div className="space-y-8">
			{vm.settings.scoresStale ? (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
					<strong>Scores may be stale.</strong>{" "}
					{vm.settings.scoresStaleReason ?? "Configuration changed."} Run a full
					rematch on a machine with az access.
				</div>
			) : null}

			{vm.error ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
					{vm.error}
				</div>
			) : null}
			{vm.toast ? (
				<div className="rounded-md border border-border bg-secondary px-4 py-2 text-sm">
					{vm.toast}
				</div>
			) : null}

			<section className="space-y-3">
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

			<section className="space-y-3">
				<h2 className="font-display text-base font-semibold">Email suffixes</h2>
				<div className="flex flex-wrap gap-2">
					{form.emailSuffixes.map((s) => (
						<Badge key={s} variant="secondary" className="gap-2">
							{s}
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground"
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

			<section className="space-y-3">
				<div className="flex items-center justify-between">
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
				<div className="overflow-x-auto rounded-md border border-border">
					<table className="w-full text-sm">
						<thead className="bg-secondary/60 text-left">
							<tr>
								<th className="px-3 py-2 font-medium">Type</th>
								<th className="px-3 py-2 font-medium">Weight</th>
							</tr>
						</thead>
						<tbody>
							{Object.keys(DEFAULT_ACTIVITY_WEIGHTS).map((key) => (
								<tr key={key} className="border-t border-border">
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

			<section className="space-y-2 rounded-md bg-secondary/40 p-4 text-sm">
				<h2 className="font-display font-semibold">Pipeline status</h2>
				<p>
					Config version: <strong>{vm.settings.pipelineConfigVersion}</strong>
				</p>
				<p>
					Stale: <strong>{vm.settings.scoresStale ? "yes" : "no"}</strong>
				</p>
			</section>

			<div className="flex justify-end gap-2">
				<Button
					type="button"
					disabled={!vm.dirty || !!vm.validationError || vm.saving}
					onClick={() => void vm.save()}
				>
					{vm.saving ? "Saving…" : "Save changes"}
				</Button>
			</div>
		</div>
	);
}

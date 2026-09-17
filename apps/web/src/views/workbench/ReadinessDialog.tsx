import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from "@nocoo/basalt";
import {
	type Project,
	type PullRequest,
	type ReadinessColor,
	type ReadinessRule,
	readinessColorSchema,
	readinessRuleKey,
} from "@signoff/domain/workbench";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import { useReadinessFormViewModel } from "@/viewmodels/useReadinessFormViewModel";
import { ReadinessSwatch } from "./WorkbenchStatus";

export function ReadinessDialog({
	project,
	pulls,
	busy,
	error,
	onSave,
	onClose,
	restoreFocus,
}: {
	project: Project;
	pulls: PullRequest[];
	busy: string | null;
	error: string | null;
	onSave: (rules: ReadinessRule[]) => Promise<boolean>;
	onClose: () => void;
	restoreFocus: () => void;
}) {
	const vm = useReadinessFormViewModel(project, pulls, onSave);
	const saving = busy === "readiness";
	const [dragging, setDragging] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	function move(key: string, index: number) {
		if (saving || index < 0 || index >= vm.rules.length) return;
		vm.moveRule(key, index);
		setNotice(`Moved to position ${index + 1} of ${vm.rules.length}.`);
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<DialogContent
				size="lg"
				className="flex max-h-[90svh] flex-col sm:max-w-2xl"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					restoreFocus();
				}}
			>
				<DialogHeader>
					<DialogTitle>Merge requirements & colors</DialogTitle>
					<DialogDescription className="break-words">
						{project.organization} / {project.projectKey}
					</DialogDescription>
				</DialogHeader>
				<p className="text-sm text-basalt-muted-foreground">
					Arrange the actual requirements from first to resolve to final merge
					steps. The first unmet requirement determines the next action; PRs
					with only later steps remaining sort higher.
				</p>
				<form
					className="flex min-h-0 flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!busy)
							void vm.submit().then((saved) => {
								if (saved) onClose();
							});
					}}
				>
					<div className="-mx-1 overflow-y-auto px-1">
						<div className="mb-2 flex items-center justify-between gap-3 text-xs text-basalt-muted-foreground">
							<span>Resolve first → final merge steps</span>
							<span>Drag or use the arrows</span>
						</div>
						<ol aria-label="Readiness priority" className="space-y-2 p-1">
							{vm.rules.map((rule, index) => {
								const key = readinessRuleKey(rule);
								const label = rule.label;
								const requirement = vm.requirements.find(
									(gate) => gate.id === rule.gateId,
								);
								return (
									<li
										key={key}
										data-readiness-rule={key}
										className={cn(
											"flex flex-wrap items-center gap-2 rounded-basalt-md border border-basalt-border p-2 transition-colors",
											dragging === key && "bg-basalt-muted/50",
										)}
										onDragOver={(event) => {
											if (dragging && !saving) {
												event.preventDefault();
												event.dataTransfer.dropEffect = "move";
											}
										}}
										onDrop={(event) => {
											event.preventDefault();
											if (dragging) move(dragging, index);
											setDragging(null);
										}}
									>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-8 w-7 shrink-0 cursor-grab active:cursor-grabbing"
											disabled={saving}
											draggable={!saving}
											aria-label={`Move ${label}`}
											title="Drag to reorder, or use the up and down arrow keys"
											onDragStart={(event) => {
												event.dataTransfer.setData("text/plain", key);
												event.dataTransfer.effectAllowed = "move";
												setDragging(key);
											}}
											onDragEnd={() => setDragging(null)}
											onKeyDown={(event) => {
												if (
													event.key === "ArrowUp" ||
													event.key === "ArrowDown"
												) {
													event.preventDefault();
													move(key, index + (event.key === "ArrowUp" ? -1 : 1));
												}
											}}
										>
											<GripVertical className="h-4 w-4" aria-hidden />
										</Button>
										<span className="w-4 text-xs tabular-nums text-basalt-muted-foreground">
											{index + 1}
										</span>
										<div className="min-w-0 flex-1 basis-28">
											<ReadinessSwatch color={rule.color}>
												<span className="truncate" title={label}>
													{label || "Display name"}
												</span>
											</ReadinessSwatch>
											<p
												className="mt-1 truncate text-[11px] text-basalt-muted-foreground"
												title={requirement?.detail}
											>
												{requirement?.definitionId
													? `Pipeline #${requirement.definitionId} · `
													: ""}
												{(requirement?.sourceIds?.length ?? 0) > 1
													? `${requirement?.sourceIds?.length} policies · applicable checks must pass`
													: requirement?.detail || requirement?.name}
											</p>
										</div>
										<SelectControl
											aria-label={`${label} color`}
											value={rule.color}
											disabled={saving}
											className="w-24"
											onChange={(color) =>
												vm.updateRule(key, {
													...rule,
													color: color as ReadinessColor,
												})
											}
										>
											{readinessColorSchema.options.map((color) => (
												<option key={color} value={color}>
													{color[0]?.toUpperCase()}
													{color.slice(1)}
												</option>
											))}
										</SelectControl>
										<div className="flex shrink-0">
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-8 w-7"
												aria-label={`Move ${label} up`}
												disabled={saving || index === 0}
												onClick={(event) => {
													focusHandle(event.currentTarget.closest("li"));
													move(key, index - 1);
												}}
											>
												<ArrowUp className="h-3.5 w-3.5" aria-hidden />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-8 w-7"
												aria-label={`Move ${label} down`}
												disabled={saving || index === vm.rules.length - 1}
												onClick={(event) => {
													focusHandle(event.currentTarget.closest("li"));
													move(key, index + 1);
												}}
											>
												<ArrowDown className="h-3.5 w-3.5" aria-hidden />
											</Button>
										</div>
										<div className="w-full pl-11">
											<Input
												aria-label={`${requirement?.name ?? rule.gateId} display name`}
												value={rule.label}
												maxLength={240}
												className="h-8"
												disabled={saving}
												onChange={(event) =>
													vm.updateRule(key, {
														...rule,
														label: event.target.value,
													})
												}
											/>
										</div>
									</li>
								);
							})}
						</ol>
						<p className="mt-3 text-xs text-basalt-muted-foreground">
							{vm.rules.length
								? "All collected merge requirements are included, even those already passing. Colors and order do not change the source results."
								: "No merge requirements collected yet. Refresh this project's PR list and checks first."}
						</p>
					</div>
					<p aria-live="polite" className="sr-only">
						{notice}
					</p>
					{vm.error || error ? (
						<AlertBanner variant="error">{vm.error || error}</AlertBanner>
					) : null}
					<DialogFooter className="flex-wrap gap-2">
						<Button
							type="button"
							variant="ghost"
							className="sm:mr-auto"
							disabled={saving}
							onClick={vm.reset}
						>
							<RotateCcw className="h-3.5 w-3.5" aria-hidden />
							Reset defaults
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={saving}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={Boolean(busy)}>
							{saving ? "Saving…" : "Save readiness"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function focusHandle(row: Element | null) {
	row?.querySelector<HTMLButtonElement>("[draggable]")?.focus();
}

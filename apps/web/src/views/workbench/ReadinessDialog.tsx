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
	READINESS_LABELS,
	type ReadinessColor,
	type ReadinessRule,
	readinessColorSchema,
	readinessRuleKey,
} from "@signoff/domain/workbench";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, X } from "lucide-react";
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
					<DialogTitle>Readiness order & colors</DialogTitle>
					<DialogDescription className="break-words">
						{project.organization} / {project.projectKey}
					</DialogDescription>
				</DialogHeader>
				<p className="text-sm text-basalt-muted-foreground">
					Order from most ready to least ready. When several items are pending,
					the lowest item determines the PR’s readiness.
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
							<span>Most ready first</span>
							<span>Drag or use the arrows</span>
						</div>
						<ol aria-label="Readiness priority" className="space-y-2 p-1">
							{vm.rules.map((rule, index) => {
								const key = readinessRuleKey(rule);
								const label =
									"kind" in rule ? READINESS_LABELS[rule.kind] : rule.label;
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
											{"policy" in rule ? (
												<p
													className="mt-1 truncate text-[11px] text-basalt-muted-foreground"
													title={rule.policy}
												>
													Policy · {rule.policy}
												</p>
											) : null}
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
										{"policy" in rule ? (
											<div className="flex w-full items-center gap-2 pl-11">
												<Input
													aria-label={`${rule.policy} display name`}
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
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="h-8 w-7 shrink-0"
													disabled={saving}
													aria-label={`Remove ${rule.policy} rule`}
													onClick={(event) => {
														const row = event.currentTarget.closest("li");
														focusHandle(
															row?.nextElementSibling ??
																row?.previousElementSibling ??
																null,
														);
														vm.removePolicy(key);
													}}
												>
													<X className="h-3.5 w-3.5" aria-hidden />
												</Button>
											</div>
										) : null}
									</li>
								);
							})}
						</ol>
						<div className="mt-3">
							<SelectControl
								aria-label="Add policy rule"
								value=""
								disabled={
									saving || !vm.policyOptions.length || vm.rules.length >= 50
								}
								onChange={vm.addPolicy}
							>
								<option value="">
									{vm.policyOptions.length
										? "Add a policy rule…"
										: "No more collected policies to add"}
								</option>
								{vm.policyOptions.map((policy) => (
									<option key={policy} value={policy}>
										{policy}
									</option>
								))}
							</SelectControl>
							<p className="mt-2 text-xs text-basalt-muted-foreground">
								Policy rules apply to pending required policies. Passed checks
								stay passed; other policies use the general states.
							</p>
						</div>
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

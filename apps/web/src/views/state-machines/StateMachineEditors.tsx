import { Button, Checkbox, Field, Input } from "@nocoo/basalt";
import {
	checkStateSchema,
	type MachineCondition,
	type ReadinessColor,
	readinessColorSchema,
	readinessKindSchema,
	type StateMachine,
} from "@signoff/domain/workbench";
import { ArrowDown, ArrowUp, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { SelectControl } from "@/components/SelectControl";
import { MACHINE_COLORS, reorder } from "@/models/stateMachineGraph";

type EditorProps = {
	config: StateMachine;
	onChange: (config: StateMachine) => void;
	selectedId?: string;
};
type Presentation = { label: string; color: ReadinessColor; group: string };
function PresentationFields({
	id,
	value,
	onChange,
}: {
	id: string;
	value: Presentation;
	onChange: (patch: Partial<Presentation>) => void;
}) {
	return (
		<div className="space-y-2">
			<Field label="Display name">
				<Input
					aria-label={`${id} display name`}
					value={value.label}
					maxLength={240}
					onChange={(e) => onChange({ label: e.target.value })}
				/>
			</Field>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Color">
					<SelectControl
						aria-label={`${id} color`}
						value={value.color}
						onChange={(color) => onChange({ color: color as ReadinessColor })}
					>
						{readinessColorSchema.options.map((color) => (
							<option key={color} value={color}>
								{color}
							</option>
						))}
					</SelectControl>
				</Field>
				<Field label="Group">
					<Input
						aria-label={`${id} group`}
						value={value.group}
						maxLength={240}
						onChange={(e) => onChange({ group: e.target.value })}
					/>
				</Field>
			</div>
		</div>
	);
}
function MoveButtons({
	label,
	index,
	length,
	onMove,
}: {
	label: string;
	index: number;
	length: number;
	onMove: (to: number) => void;
}) {
	return (
		<span className="flex shrink-0">
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className="h-7 w-7"
				aria-label={`Move ${label} up`}
				disabled={index === 0}
				onClick={() => onMove(index - 1)}
			>
				<ArrowUp size={13} aria-hidden />
			</Button>
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className="h-7 w-7"
				aria-label={`Move ${label} down`}
				disabled={index === length - 1}
				onClick={() => onMove(index + 1)}
			>
				<ArrowDown size={13} aria-hidden />
			</Button>
		</span>
	);
}
export function GatesEditor({ config, onChange, selectedId }: EditorProps) {
	return (
		<div className="space-y-3">
			<p className="text-xs leading-5 text-basalt-muted-foreground">
				Checks run concurrently; every blocker remains visible. Choose the most
				urgent blocker or your first unmet gate. Moving a gate selects gate
				order.
			</p>
			<Field label="Main status priority">
				<SelectControl
					aria-label="Main status priority"
					value={config.priority ?? "gate"}
					onChange={(priority) =>
						onChange({ ...config, priority: priority as "gate" | "severity" })
					}
				>
					<option value="severity">Severity · most urgent blocker</option>
					<option value="gate">Gate order · first unmet gate</option>
				</SelectControl>
			</Field>
			<ol aria-label="Readiness priority" className="space-y-2">
				{config.gates.map((gate, index) => (
					<li
						key={gate.gateId}
						className="rounded-xl border border-basalt-border"
					>
						<div className="flex items-center gap-2 px-3 pt-2">
							<span className="text-[11px] tabular-nums text-basalt-muted-foreground">
								{index + 1}
							</span>
							<span
								className="h-2 w-2 shrink-0 rounded-full"
								style={{ background: MACHINE_COLORS[gate.color] }}
							/>
							<span
								className="min-w-0 flex-1 truncate text-xs font-medium"
								title={gate.label}
							>
								{gate.label}
							</span>
							<MoveButtons
								label={gate.label}
								index={index}
								length={config.gates.length}
								onMove={(to) =>
									onChange({
										...config,
										priority: "gate",
										gates: reorder(config.gates, index, to),
									})
								}
							/>
						</div>
						<details
							open={selectedId === gate.gateId || undefined}
							className="px-3 pb-3"
						>
							<summary className="cursor-pointer py-2 text-[11px] text-basalt-muted-foreground">
								Name, color & group
							</summary>
							<PresentationFields
								id={gate.gateId}
								value={gate}
								onChange={(patch) =>
									onChange({
										...config,
										gates: config.gates.map((g) =>
											g.gateId === gate.gateId ? { ...g, ...patch } : g,
										),
									})
								}
							/>
						</details>
					</li>
				))}
			</ol>
			{!config.gates.length ? (
				<p className="text-xs text-basalt-muted-foreground">
					No collected gates yet. Explicitly discover PRs to populate this
					repository.
				</p>
			) : null}
		</div>
	);
}
export function StatesEditor({ config, onChange, selectedId }: EditorProps) {
	return (
		<div className="space-y-3">
			<p className="text-xs leading-5 text-basalt-muted-foreground">
				Customize names and colors, or add a state for a mapping. Built-in state
				meanings remain protected.
			</p>
			{config.states.map((state) => {
				const protectedState = readinessKindSchema.options.some(
					(kind) => kind === state.id,
				);
				const referenced = config.mappings.some(
					(rule) => rule.stateId === state.id,
				);
				const update = (patch: Partial<typeof state>) =>
					onChange({
						...config,
						states: config.states.map((s) =>
							s.id === state.id ? { ...s, ...patch } : s,
						),
					});
				return (
					<details
						key={state.id}
						open={selectedId === state.id || !protectedState || undefined}
						className="rounded-xl border border-basalt-border p-3"
					>
						<summary className="cursor-pointer text-xs font-medium">
							<span
								className="mr-2 inline-block h-2 w-2 rounded-full"
								style={{ background: MACHINE_COLORS[state.color] }}
							/>
							{state.label}
							{protectedState ? (
								<LockKeyhole
									size={11}
									className="ml-2 inline text-basalt-muted-foreground"
									aria-label="Protected meaning"
								/>
							) : null}
						</summary>
						<div className="mt-3 space-y-3">
							<PresentationFields
								id={state.id}
								value={state}
								onChange={update}
							/>
							<Field label="Meaning">
								<SelectControl
									aria-label={`${state.id} meaning`}
									value={state.kind}
									disabled={protectedState}
									onChange={(kind) =>
										update({ kind: kind as typeof state.kind })
									}
								>
									{readinessKindSchema.options.map((kind) => (
										<option key={kind} value={kind}>
											{kind}
										</option>
									))}
								</SelectControl>
							</Field>
							{!protectedState ? (
								<Button
									size="sm"
									variant="ghost"
									disabled={referenced}
									title={
										referenced
											? "Remove mappings to this state first"
											: undefined
									}
									aria-label={`Delete ${state.id}`}
									onClick={() =>
										onChange({
											...config,
											states: config.states.filter((s) => s.id !== state.id),
										})
									}
								>
									<Trash2 size={13} aria-hidden />
									{referenced ? "Used by a mapping" : "Delete state"}
								</Button>
							) : null}
						</div>
					</details>
				);
			})}
			<Button
				size="sm"
				variant="outline"
				disabled={config.states.length >= 60}
				onClick={() =>
					onChange({
						...config,
						states: [
							...config.states,
							{
								id: `custom:${crypto.randomUUID()}`,
								label: "New state",
								kind: "blocked",
								color: "purple",
								group: "Custom",
							},
						],
					})
				}
			>
				<Plus size={14} aria-hidden />
				Add state
			</Button>
		</div>
	);
}
const CONDITION_LABELS: Record<MachineCondition["fact"], string> = {
	lifecycle: "Lifecycle",
	draft: "Draft",
	mergeable: "Mergeability",
	coverage: "Collection coverage",
	checksValidity: "Check validity",
	baseline: "Default judgment",
	gate: "Gate result",
	policyStatus: "Provider policy status",
	buildExpired: "Build expired",
	buildNotCurrent: "Build behind target",
};
const CHOICES = {
	lifecycle: ["open", "merged", "closed"],
	mergeable: ["clear", "conflicts", "unknown"],
	coverage: ["complete", "partial"],
	checksValidity: ["valid", "missing", "invalidated"],
	baseline: readinessKindSchema.options,
	gate: checkStateSchema.options,
};
function initialCondition(
	fact: MachineCondition["fact"],
	gateId: string,
): MachineCondition {
	switch (fact) {
		case "draft":
			return { fact, equals: true };
		case "buildExpired":
		case "buildNotCurrent":
			return { fact, gateId, equals: true };
		case "policyStatus":
			return { fact, gateId, oneOf: ["approved"] };
		case "gate":
			return { fact, gateId, oneOf: ["passed"] };
		case "lifecycle":
			return { fact, oneOf: ["open"] };
		case "mergeable":
			return { fact, oneOf: ["clear"] };
		case "coverage":
			return { fact, oneOf: ["complete"] };
		case "checksValidity":
			return { fact, oneOf: ["valid"] };
		case "baseline":
			return { fact, oneOf: ["blocked"] };
	}
}
function ConditionEditor({
	condition,
	gates,
	onChange,
}: {
	condition: MachineCondition;
	gates: StateMachine["gates"];
	onChange: (condition: MachineCondition) => void;
}) {
	return (
		<div className="space-y-2">
			<SelectControl
				aria-label="Condition fact"
				value={condition.fact}
				onChange={(fact) =>
					onChange(
						initialCondition(
							fact as MachineCondition["fact"],
							gates[0]?.gateId ?? "",
						),
					)
				}
			>
				{Object.entries(CONDITION_LABELS).map(([fact, label]) => (
					<option key={fact} value={fact}>
						{label}
					</option>
				))}
			</SelectControl>
			{"gateId" in condition ? (
				<SelectControl
					aria-label="Condition gate"
					value={condition.gateId}
					onChange={(gateId) => onChange({ ...condition, gateId })}
				>
					{gates.map((gate) => (
						<option key={gate.gateId} value={gate.gateId}>
							{gate.label}
						</option>
					))}
				</SelectControl>
			) : null}
			{"equals" in condition ? (
				<SelectControl
					aria-label="Condition value"
					value={String(condition.equals)}
					onChange={(value) =>
						onChange({ ...condition, equals: value === "true" })
					}
				>
					<option value="true">Yes</option>
					<option value="false">No</option>
				</SelectControl>
			) : condition.fact === "policyStatus" ? (
				<Input
					aria-label="Provider statuses, comma separated"
					value={condition.oneOf.join(", ")}
					onChange={(e) =>
						onChange({
							...condition,
							oneOf: e.target.value.split(",").map((v) => v.trim()),
						})
					}
				/>
			) : (
				<fieldset
					className="flex flex-wrap gap-1.5"
					aria-label="Any of these values"
				>
					{CHOICES[condition.fact].map((value) => {
						const selected = (condition.oneOf as string[]).includes(value);
						return (
							<Button
								variant="ghost"
								size="sm"
								type="button"
								key={value}
								aria-pressed={selected}
								className={`rounded-md border px-2 py-1 text-[11px] ${selected ? "border-basalt-primary/40 bg-basalt-primary/10 text-basalt-primary" : "border-basalt-border text-basalt-muted-foreground"}`}
								onClick={() =>
									onChange({
										...condition,
										oneOf: selected
											? condition.oneOf.filter((v) => v !== value)
											: [...condition.oneOf, value],
									} as MachineCondition)
								}
							>
								{value}
							</Button>
						);
					})}
				</fieldset>
			)}
		</div>
	);
}
export function MappingsEditor({ config, onChange, selectedId }: EditorProps) {
	return (
		<div className="space-y-3">
			<p className="text-xs leading-5 text-basalt-muted-foreground">
				First matching rule wins. AND requires every condition; OR accepts any.
				Terminal, incomplete and unknown facts remain protected.
			</p>
			<Button
				size="sm"
				variant="outline"
				disabled={config.mappings.length >= 100}
				onClick={() =>
					onChange({
						...config,
						mappings: [
							{
								id: `rule:${crypto.randomUUID()}`,
								name: "New mapping",
								stateId: "blocked",
								enabled: true,
								match: "all",
								conditions: [{ fact: "lifecycle", oneOf: ["open"] }],
							},
							...config.mappings,
						],
					})
				}
			>
				<Plus size={14} aria-hidden />
				Add mapping
			</Button>
			{config.mappings.map((rule, index) => {
				const update = (patch: Partial<typeof rule>) =>
					onChange({
						...config,
						mappings: config.mappings.map((r) =>
							r.id === rule.id ? { ...r, ...patch } : r,
						),
					});
				return (
					<div
						key={rule.id}
						className="rounded-xl border border-basalt-border p-3"
					>
						<div className="mb-1 flex items-center justify-between">
							<label
								htmlFor={`${rule.id}-enabled`}
								className="flex items-center gap-2 text-[11px] text-basalt-muted-foreground"
							>
								<Checkbox
									id={`${rule.id}-enabled`}
									aria-label={`${rule.name} enabled`}
									checked={rule.enabled}
									onCheckedChange={(checked) =>
										update({ enabled: checked === true })
									}
								/>
								{index + 1} · {rule.enabled ? "Enabled" : "Disabled"}
							</label>
							<MoveButtons
								label={rule.name}
								index={index}
								length={config.mappings.length}
								onMove={(to) =>
									onChange({
										...config,
										mappings: reorder(config.mappings, index, to),
									})
								}
							/>
						</div>
						<details
							open={
								selectedId === rule.id ||
								rule.name === "New mapping" ||
								undefined
							}
						>
							<summary className="cursor-pointer text-xs font-medium">
								{rule.name}
							</summary>
							<div className="mt-3 space-y-3">
								<Field label="Rule name">
									<Input
										aria-label={`${rule.id} name`}
										value={rule.name}
										maxLength={240}
										onChange={(e) => update({ name: e.target.value })}
									/>
								</Field>
								<Field label="Output state">
									<SelectControl
										aria-label={`${rule.name} output state`}
										value={rule.stateId}
										onChange={(stateId) => update({ stateId })}
									>
										{config.states.map((s) => (
											<option key={s.id} value={s.id}>
												{s.label}
											</option>
										))}
									</SelectControl>
								</Field>
								<SelectControl
									aria-label={`${rule.name} condition matching`}
									value={rule.match}
									onChange={(match) =>
										update({ match: match as "all" | "any" })
									}
								>
									<option value="all">AND · all conditions</option>
									<option value="any">OR · any condition</option>
								</SelectControl>
								{rule.conditions.map((condition, at) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: typed condition slots are fully controlled and have no identity or local state
										key={`${rule.id}:${at}`}
										className="rounded-lg bg-basalt-muted/40 p-2"
									>
										<div className="mb-2 flex items-center justify-between text-[10px] text-basalt-muted-foreground">
											<span>Condition {at + 1}</span>
											<Button
												size="icon"
												variant="ghost"
												className="h-6 w-6"
												aria-label={`Remove condition ${at + 1} from ${rule.name}`}
												disabled={rule.conditions.length === 1}
												onClick={() =>
													update({
														conditions: rule.conditions.filter(
															(_, i) => i !== at,
														),
													})
												}
											>
												<Trash2 size={11} aria-hidden />
											</Button>
										</div>
										<ConditionEditor
											condition={condition}
											gates={config.gates}
											onChange={(next) =>
												update({
													conditions: rule.conditions.map((c, i) =>
														i === at ? next : c,
													),
												})
											}
										/>
									</div>
								))}
								<div className="flex justify-between gap-2">
									<Button
										size="sm"
										variant="ghost"
										disabled={rule.conditions.length >= 20}
										onClick={() =>
											update({
												conditions: [
													...rule.conditions,
													{ fact: "coverage", oneOf: ["complete"] },
												],
											})
										}
									>
										<Plus size={12} aria-hidden />
										Condition
									</Button>
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Delete mapping ${rule.id}`}
										onClick={() =>
											onChange({
												...config,
												mappings: config.mappings.filter(
													(r) => r.id !== rule.id,
												),
											})
										}
									>
										<Trash2 size={12} aria-hidden />
										Delete
									</Button>
								</div>
							</div>
						</details>
					</div>
				);
			})}
		</div>
	);
}

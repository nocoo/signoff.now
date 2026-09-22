import { Button, Field, LayerCard } from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { SelectControl } from "@/components/SelectControl";
import { useAiRulesViewModel } from "@/viewmodels/useAiRulesViewModel";
export function AiRulesEditor() {
	const vm = useAiRulesViewModel();
	return (
		<LayerCard className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="font-semibold">Classification rules</h2>
				<SelectControl
					aria-label="AI rule scope"
					value={vm.scope}
					onChange={vm.select}
					disabled={vm.busy}
					className="w-72"
				>
					<option value="common">General / common sense</option>
					{vm.rules.data?.projects.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</SelectControl>
			</div>
			<p className="text-sm text-basalt-muted-foreground">
				Explain what the PR developer should do next. Project rules add context
				to the common rules. Policy descriptions and their priority are
				configured in System → Policy instructions.
			</p>
			<Field
				label={
					vm.scope === "common" ? "General rules" : "Project-specific rules"
				}
				htmlFor="ai-rule-text"
			>
				<InputArea
					id="ai-rule-text"
					value={vm.text}
					onChange={(e) => vm.edit(e.target.value)}
					rows={10}
					disabled={vm.busy || !vm.current}
				/>
			</Field>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					disabled={vm.busy || !vm.current}
					onClick={() => void vm.save()}
				>
					{vm.busy ? "Saving…" : "Save rules"}
				</Button>
				<span role="status" className="text-sm">
					{vm.message || vm.rules.error}
				</span>
			</div>
		</LayerCard>
	);
}

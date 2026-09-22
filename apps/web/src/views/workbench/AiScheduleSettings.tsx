import { Label } from "@nocoo/basalt";
import { useId } from "react";
import { SelectControl } from "@/components/SelectControl";
import { useAiScheduleViewModel } from "@/viewmodels/useAiScheduleViewModel";
export function AiScheduleSettings({
	source,
	now,
}: {
	source: "cli" | "demo";
	now: number;
}) {
	const vm = useAiScheduleViewModel(source),
		id = useId();
	return (
		<section
			className="space-y-3 border-t border-basalt-border pt-3"
			aria-label="Jev scheduling"
		>
			<h3 className="text-sm font-semibold">Jev readiness</h3>
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor={id} className="text-xs">
					Per-PR cooldown
				</Label>
				<SelectControl
					id={id}
					aria-label="Jev evaluation cooldown"
					value={String(vm.data?.cooldownSeconds ?? 300)}
					disabled={!vm.data || vm.saving}
					onChange={(value) => void vm.save(Number(value))}
					className="h-8 w-28 text-xs"
				>
					{[60, 120, 300, 600, 900, 1800, 3600].map((seconds) => (
						<option key={seconds} value={seconds}>
							{seconds / 60} min
						</option>
					))}
				</SelectControl>
			</div>
			<p className="text-xs text-basalt-muted-foreground">
				Changed watched PRs are evaluated individually in the background.
				Identical evidence reuses the project cache. Each PR waits from request
				completion.
			</p>
			{Boolean(vm.error || vm.mutationError) && (
				<p role="alert" className="text-xs text-basalt-destructive">
					{vm.mutationError || vm.error}
				</p>
			)}
			{vm.data?.projects.map((project) => (
				<div key={project.id} className="space-y-1 text-xs">
					<p className="font-medium">{project.name}</p>
					<p
						className="text-basalt-muted-foreground"
						title={
							project.lastCompletedAt
								? new Date(project.lastCompletedAt * 1000).toLocaleString()
								: undefined
						}
					>
						{project.lastCompletedAt === null
							? "Awaiting first evaluation"
							: `Last request ${Math.max(0, Math.floor((now - project.lastCompletedAt) / 60))}m ago`}
					</p>
					{project.requestCount > 0 && (
						<p className="text-basalt-muted-foreground">
							{project.requestCount} requests
							{project.inputTokens !== null
								? ` · ${project.inputTokens.toLocaleString()} input tokens`
								: ""}
						</p>
					)}
				</div>
			))}
		</section>
	);
}

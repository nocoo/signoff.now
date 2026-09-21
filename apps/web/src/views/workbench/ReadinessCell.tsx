import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { readinessDisplay } from "@/models/readinessDisplay";
import { ReadinessBadge } from "./WorkbenchStatus";

export function ReadinessCell({
	display,
	failed,
}: {
	display: ReturnType<typeof readinessDisplay>;
	failed: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="space-y-1">
			<ReadinessBadge readiness={display.badge} />
			{Boolean(display.note) && (
				<Tooltip open={open} onOpenChange={setOpen}>
					<TooltipTrigger asChild>
						<Button
							variant="link"
							className={cn(
								"block h-auto max-w-full truncate p-0 text-left text-[11px] font-normal text-basalt-muted-foreground",
								failed && "text-basalt-destructive",
							)}
							onClick={(event) => {
								event.preventDefault();
								setOpen(true);
							}}
						>
							{display.note}
						</Button>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs text-xs leading-5">
						{display.detail}
					</TooltipContent>
				</Tooltip>
			)}
		</div>
	);
}

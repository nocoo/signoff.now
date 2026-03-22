/**
 * WindowControls — minimize / maximize / close buttons for Windows & Linux.
 *
 * Not rendered on macOS where native traffic lights are used instead.
 */

import { Button } from "@signoff/ui/button";
import { Minus, Square, X } from "lucide-react";
import { trpc } from "../../lib/trpc";

export function WindowControls() {
	const minimizeMutation = trpc.window.minimize.useMutation();
	const maximizeMutation = trpc.window.maximize.useMutation();
	const closeMutation = trpc.window.close.useMutation();

	return (
		<div className="flex items-center">
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground"
				onClick={() => minimizeMutation.mutate()}
				aria-label="Minimize window"
			>
				<Minus className="h-3.5 w-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground"
				onClick={() => maximizeMutation.mutate()}
				aria-label="Maximize window"
			>
				<Square className="h-3 w-3" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground hover:bg-destructive hover:text-destructive-foreground"
				onClick={() => closeMutation.mutate()}
				aria-label="Close window"
			>
				<X className="h-4 w-4" />
			</Button>
		</div>
	);
}

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FieldProps = {
	label: string;
	/** Receives the generated id, so the label always points at the control. */
	children: (id: string) => React.ReactNode;
	hint?: string;
	error?: string;
	className?: string;
};

/**
 * One label above one control, with the gap owned here.
 *
 * Every caller previously chose its own wrapper (`space-y-1`, `space-y-1.5`,
 * `space-y-2`, `mt-1`), so the same form showed three different label gaps.
 * Routing them through one component makes the spacing a decision made once.
 *
 * The id is generated and handed to the child rather than passed in: a label
 * whose `htmlFor` does not match anything is invisible breakage — it looks
 * right and does nothing for a screen reader or a click on the text.
 */
export function Field({ label, children, hint, error, className }: FieldProps) {
	const id = useId();
	return (
		<div className={cn("flex flex-col gap-(--control-gap)", className)}>
			<Label htmlFor={id}>{label}</Label>
			{children(id)}
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : hint ? (
				<p className="text-xs text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
}

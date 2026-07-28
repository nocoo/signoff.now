import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * L3 control: same bg as L2 card, border provides affordance (B05).
 *
 * Height, padding and radius come from the control tokens so this and Select
 * cannot drift apart — they sit side by side in most forms.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
	({ className, type, ...props }, ref) => {
		return (
			<input
				type={type}
				className={cn(
					"flex h-(--control-h) w-full rounded-(--control-radius) border border-border bg-secondary px-(--control-pad-x) text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground transition-colors hover:border-foreground/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-transparent disabled:text-muted-foreground/38 md:text-sm",
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
Input.displayName = "Input";

export { Input };

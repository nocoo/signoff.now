import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native select styled to match Input.
 *
 * The browser's own arrow is unstyleable and sits hard against the right
 * border, so it is removed (`appearance-none`) and redrawn inset by the same
 * trailing pad the text reserves — otherwise the glyph collides with the edge.
 *
 * Native rather than a Radix listbox: these are short, non-searchable lists,
 * and the native control brings keyboard and mobile behaviour for free.
 */
const Select = React.forwardRef<
	HTMLSelectElement,
	React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => (
	<div className="relative w-full">
		<select
			ref={ref}
			className={cn(
				"h-(--control-h) w-full appearance-none rounded-(--control-radius) border border-border bg-secondary ps-(--control-pad-x) pe-(--control-pad-trailing) text-sm text-foreground transition-colors hover:border-foreground/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:cursor-not-allowed disabled:border-transparent disabled:text-muted-foreground/38",
				className,
			)}
			{...props}
		>
			{children}
		</select>
		<ChevronDown
			aria-hidden
			className="pointer-events-none absolute end-(--control-pad-x) top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
		/>
	</div>
));
Select.displayName = "Select";

export { Select };

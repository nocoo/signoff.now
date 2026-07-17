import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-border bg-secondary text-secondary-foreground",
				outline: "border-border text-foreground",
				success: "border-transparent bg-success text-success-foreground",
				warning: "border-transparent bg-warning text-warning-foreground",
				destructive:
					"border-transparent bg-destructive text-destructive-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

export function Badge({
	className,
	variant,
	...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
	return (
		<div className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

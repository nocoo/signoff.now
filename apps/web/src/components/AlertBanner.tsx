import { AlertTriangle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const VARIANTS = {
	error: {
		wrap: "border-destructive/30 bg-destructive/10 text-destructive",
		Icon: XCircle,
	},
	warning: {
		wrap: "border-warning/40 bg-warning/10 text-foreground",
		Icon: AlertTriangle,
	},
	info: {
		wrap: "border-primary/30 bg-primary/10 text-foreground",
		Icon: Info,
	},
} as const;

export function AlertBanner({
	variant = "info",
	children,
	className,
}: {
	variant?: keyof typeof VARIANTS;
	children: React.ReactNode;
	className?: string;
}) {
	const { wrap, Icon } = VARIANTS[variant];
	return (
		<div
			className={cn(
				"flex gap-3 rounded-[var(--radius-widget)] border px-4 py-3 text-sm",
				wrap,
				className,
			)}
			role={variant === "error" ? "alert" : "status"}
		>
			<Icon className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden />
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

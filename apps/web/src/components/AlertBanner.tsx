import { Banner } from "@nocoo/basalt/components/banner";
import { AlertTriangle, Info, XCircle } from "lucide-react";

const VARIANTS = {
	error: { variant: "error", Icon: XCircle },
	warning: { variant: "alert", Icon: AlertTriangle },
	info: { variant: "default", Icon: Info },
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
	const { variant: basaltVariant, Icon } = VARIANTS[variant];
	return (
		<Banner
			variant={basaltVariant}
			icon={<Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
			className={className}
			role={variant === "error" ? "alert" : "status"}
		>
			{children}
		</Banner>
	);
}

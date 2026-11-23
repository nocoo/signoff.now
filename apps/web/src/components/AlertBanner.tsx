import { Banner } from "@nocoo/basalt/components/banner";
import { AlertTriangle, Info, XCircle } from "@nocoo/basalt/icons";

const VARIANTS = {
	error: { tone: "danger", Icon: XCircle },
	warning: { tone: "warning", Icon: AlertTriangle },
	info: { tone: "neutral", Icon: Info },
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
	const { tone: basaltTone, Icon } = VARIANTS[variant];
	return (
		<Banner
			tone={basaltTone}
			icon={<Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
			className={className}
			role={variant === "error" ? "alert" : "status"}
		>
			{children}
		</Banner>
	);
}

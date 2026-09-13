import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";

export function Skeleton({ className }: { className?: string }) {
	return (
		<div className={className}>
			<SkeletonLine className="h-full" minWidth={100} maxWidth={100} />
		</div>
	);
}

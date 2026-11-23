import { Skeleton as BasaltSkeleton } from "@nocoo/basalt/components/skeleton";

export function Skeleton({ className }: { className?: string }) {
	return (
		<div className={className}>
			<BasaltSkeleton variant="block" className="h-full" />
		</div>
	);
}

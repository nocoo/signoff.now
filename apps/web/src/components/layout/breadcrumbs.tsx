import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import type { BreadcrumbItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
	return (
		<nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
			<ol className="flex items-center gap-1 text-muted-foreground">
				{items.map((item, index) => {
					const isLast = index === items.length - 1;
					const key = item.href ?? `crumb-${item.label}`;
					return (
						<li key={key} className="flex items-center gap-1">
							{index > 0 ? (
								<ChevronRight
									className="h-3 w-3 shrink-0 text-muted-foreground/60"
									strokeWidth={1.5}
									aria-hidden
								/>
							) : null}
							{item.href && !isLast ? (
								<Link
									to={item.href}
									className="hover:text-foreground transition-colors"
								>
									{item.label}
								</Link>
							) : (
								<span
									className={cn(isLast && "text-foreground font-medium")}
									aria-current={isLast ? "page" : undefined}
								>
									{item.label}
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

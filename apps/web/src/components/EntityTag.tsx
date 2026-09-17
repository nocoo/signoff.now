import { Badge } from "@nocoo/basalt";
import { contrastTextColor } from "@/lib/avatar";
import type { Tag } from "@/models/entities";

/** Keeps stored tag colors, including colors outside Basalt's named palette. */
export function EntityTag({ tag }: { tag: Pick<Tag, "name" | "color"> }) {
	return (
		<Badge
			variant={null}
			className="max-w-full whitespace-normal break-all"
			style={{
				backgroundColor: tag.color,
				color: contrastTextColor(tag.color),
			}}
		>
			{tag.name}
		</Badge>
	);
}

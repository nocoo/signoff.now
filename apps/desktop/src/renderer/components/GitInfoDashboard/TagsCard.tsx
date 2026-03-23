/**
 * TagsCard — tag count, latest tag, tag list.
 */

import type { GitTags } from "@signoff/gitinfo";
import { Tag } from "lucide-react";
import { DashboardCard } from "./DashboardCard";
import { relativeDate, StatNumber } from "./StatNumber";

interface TagsCardProps {
	tags: GitTags;
}

export function TagsCard({ tags }: TagsCardProps) {
	const visible = tags.tags.slice(0, 20);

	return (
		<DashboardCard title="Tags" icon={<Tag className="h-4 w-4" />}>
			<div className="mb-3 flex gap-4">
				<StatNumber label="Total" value={tags.count} />
				{tags.latestReachableTag !== null && (
					<StatNumber label="Latest" value={tags.latestReachableTag} />
				)}
				{tags.commitsSinceTag !== null && (
					<StatNumber label="Since tag" value={tags.commitsSinceTag} />
				)}
			</div>

			{visible.length > 0 && (
				<div className="max-h-64 overflow-y-auto">
					<div className="flex flex-col gap-1">
						{visible.map((tag) => (
							<div
								key={tag.name}
								className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
							>
								<span className="min-w-0 flex-1 truncate font-medium">
									{tag.name}
								</span>
								<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
									{tag.type}
								</span>
								{tag.message !== null && (
									<span className="max-w-32 shrink-0 truncate text-muted-foreground">
										{tag.message}
									</span>
								)}
								{tag.date !== null && (
									<span className="shrink-0 text-muted-foreground">
										{relativeDate(tag.date)}
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</DashboardCard>
	);
}

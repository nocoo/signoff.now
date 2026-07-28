import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarColor, avatarInitial, usableAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const SIZES = {
	sm: "h-6 w-6 text-[10px]",
	md: "h-8 w-8 text-xs",
	lg: "h-10 w-10 text-sm",
} as const;

export type EntityAvatarProps = {
	name: string;
	avatarUrl?: string | null;
	size?: keyof typeof SIZES;
	className?: string;
};

/**
 * A team or developer avatar: the custom image when there is a usable one,
 * otherwise an initial on a colour derived from the name.
 *
 * Radix falls back on its own when the image 404s, so a dead URL degrades to
 * the generated swatch rather than a broken-image icon.
 *
 * `referrerPolicy="no-referrer"` because the URL is attacker-choosable: anyone
 * who can edit a roster row picks a host that every manager's browser then
 * fetches. That cannot be prevented from here (see the note in the README on
 * proxying), but it should not additionally hand over which page they were on.
 */
export function EntityAvatar({
	name,
	avatarUrl,
	size = "md",
	className,
}: EntityAvatarProps) {
	const src = usableAvatarUrl(avatarUrl);
	return (
		<Avatar className={cn(SIZES[size], className)}>
			{src ? (
				<AvatarImage src={src} alt="" referrerPolicy="no-referrer" />
			) : null}
			<AvatarFallback
				className="font-medium text-white"
				style={{ backgroundColor: avatarColor(name) }}
			>
				{avatarInitial(name)}
			</AvatarFallback>
		</Avatar>
	);
}

/** Avatar and name together — the pairing used everywhere an entity is listed. */
export function EntityLabel({
	name,
	avatarUrl,
	size = "md",
	className,
	secondary,
}: EntityAvatarProps & { secondary?: string }) {
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<EntityAvatar name={name} avatarUrl={avatarUrl} size={size} />
			<span className="min-w-0">
				<span className="block truncate font-medium">{name}</span>
				{secondary ? (
					<span className="block truncate font-mono text-xs text-muted-foreground">
						{secondary}
					</span>
				) : null}
			</span>
		</span>
	);
}

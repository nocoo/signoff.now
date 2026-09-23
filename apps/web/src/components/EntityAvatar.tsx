import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt";
import type { DataSource } from "@signoff/domain/insights";
import { createContext, useContext, useEffect, useState } from "react";
import { avatarColor, avatarInitial, cachedAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export const AvatarSourceContext = createContext<DataSource>("cli");

const SIZES = {
	xs: "h-5 w-5 text-[9px]",
	sm: "h-6 w-6 text-[10px]",
	md: "h-8 w-8 text-xs",
	lg: "h-10 w-10 text-sm",
} as const;

export type EntityAvatarProps = {
	name: string;
	avatarUrl?: string | null;
	source?: DataSource;
	size?: keyof typeof SIZES;
	className?: string;
};

function CachedAvatarImage({ src }: { src: string }) {
	const [attempt, setAttempt] = useState(0);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (!failed) return;
		const retry = () => {
			if (document.visibilityState === "hidden") return;
			setFailed(false);
			setAttempt((previous) => previous + 1);
		};
		const timer = setTimeout(retry, 60_000);
		document.addEventListener("visibilitychange", retry);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", retry);
		};
	}, [failed]);
	return (
		<AvatarImage
			key={attempt}
			src={src}
			alt=""
			referrerPolicy="no-referrer"
			onLoadingStatusChange={(status) => setFailed(status === "error")}
		/>
	);
}

export function EntityAvatar({
	name,
	avatarUrl,
	source,
	size = "md",
	className,
}: EntityAvatarProps) {
	const inheritedSource = useContext(AvatarSourceContext);
	const src = cachedAvatarUrl(avatarUrl, source ?? inheritedSource);
	return (
		<Avatar aria-hidden className={cn(SIZES[size], className)}>
			{src ? <CachedAvatarImage key={src} src={src} /> : null}
			<AvatarFallback
				className="font-medium text-white [font-size:inherit]"
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
	source,
	size = "md",
	className,
	secondary,
}: EntityAvatarProps & { secondary?: string }) {
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<EntityAvatar
				name={name}
				avatarUrl={avatarUrl}
				source={source}
				size={size}
			/>
			<span className="min-w-0">
				<span className="block truncate font-medium" title={name}>
					{name}
				</span>
				{secondary ? (
					<span className="block truncate font-mono text-xs text-basalt-muted-foreground">
						{secondary}
					</span>
				) : null}
			</span>
		</span>
	);
}

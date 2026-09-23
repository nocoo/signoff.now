import { z } from "zod";

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_REFRESH_SECONDS = 7 * 86400;
export const avatarContentTypeSchema = z.enum([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);
export const avatarTaskSchema = z.object({
	source: z.enum(["cli", "demo"]),
	url: z.string().url().max(2048),
	organization: z.string().min(1).max(240),
	leaseToken: z.string().uuid(),
});
export type AvatarTask = z.infer<typeof avatarTaskSchema>;
export type CachedAvatar = {
	contentType: z.infer<typeof avatarContentTypeSchema>;
	bytes: Uint8Array;
};

export function isAdoAvatarUrl(value: string, organization: string): boolean {
	try {
		const url = new URL(value);
		const org = organization.toLowerCase();
		return (
			url.protocol === "https:" &&
			url.host === "dev.azure.com" &&
			!url.username &&
			!url.password &&
			!url.hash &&
			/^[a-z0-9][a-z0-9-]*$/.test(org) &&
			url.pathname.toLowerCase() === `/${org}/_api/_common/identityimage` &&
			url.searchParams.size === 1 &&
			Boolean(url.searchParams.get("id"))
		);
	} catch {
		return false;
	}
}

import type { Session } from "@signoff/domain/principal";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";

/** Gravatar accepts SHA-256 of the trimmed, lowercased email. */
export async function gravatarUrl(email: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(email.trim().toLowerCase()),
	);
	const hash = [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `https://gravatar.com/avatar/${hash}?s=128&d=404`;
}

export async function meRoute(c: Context<AppEnv>) {
	const caller = c.get("caller") ?? { kind: "anonymous" as const };
	const identified = caller.kind === "person" || caller.kind === "service";
	const session: Session = {
		authenticated: identified,
		local: caller.kind === "local",
		principal: identified ? caller.principal : null,
		email: caller.kind === "person" ? (c.get("accessEmail") ?? null) : null,
		// A service token has no email; the sidebar shows its Client ID as
		// the name so an automated session is never mistaken for a person's.
		name: identified ? (c.get("accessName") ?? null) : null,
		avatarUrl:
			caller.kind === "person"
				? await gravatarUrl(caller.principal.slice("email:".length))
				: null,
		service: caller.kind === "service",
		admin: caller.kind === "local" || (identified && caller.admin),
		tenants: identified ? caller.tenants : [],
		tenantId: identified ? caller.tenantId : null,
	};
	c.header("Cache-Control", "no-store");
	return c.json(session);
}

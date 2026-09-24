import { z } from "zod";

/** Stable caller key: `email:<lowercased email>` or `service:<Access client id>`. */
export const principalSchema = z
	.string()
	.max(300)
	.regex(/^(email|service):\S+$/);
export type Principal = z.infer<typeof principalSchema>;

const emailSchema = z.email().max(254);

export const emailPrincipal = (email: string): Principal =>
	`email:${email.trim().toLowerCase()}`;
export const servicePrincipal = (clientId: string): Principal =>
	`service:${clientId.trim()}`;

/** Admin input: an email address, or an explicit `service:<client id>`. */
export function memberPrincipal(input: string): Principal | null {
	const value = input.trim();
	if (/^service:/i.test(value)) {
		const id = value.slice("service:".length).trim();
		return id && !/\s/.test(id) && id.length <= 240
			? servicePrincipal(id)
			: null;
	}
	return emailSchema.safeParse(value.toLowerCase()).success
		? emailPrincipal(value)
		: null;
}

/** `SIGNOFF_ADMIN_EMAILS`: comma-separated; invalid entries are ignored. */
export function parseAdminPrincipals(
	value: string | undefined,
): Set<Principal> {
	const principals = new Set<Principal>();
	for (const entry of (value ?? "").split(",")) {
		const principal = entry.trim() ? memberPrincipal(entry) : null;
		if (principal) principals.add(principal);
	}
	return principals;
}

export const tenantSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

/**
 * An explicit request must name an available tenant; otherwise prefer the
 * default tenant, then the first available one.
 */
export function selectTenant(
	requested: string | undefined,
	available: TenantSummary[],
): string | null {
	if (requested)
		return available.some((t) => t.id === requested) ? requested : null;
	return (
		available.find((t) => t.id === "default")?.id ?? available[0]?.id ?? null
	);
}

export const sessionSchema = z.object({
	authenticated: z.boolean(),
	local: z.boolean(),
	principal: z.string().nullable(),
	email: z.string().nullable(),
	name: z.string().nullable(),
	service: z.boolean(),
	admin: z.boolean(),
	tenants: z.array(tenantSummarySchema),
	tenantId: z.string().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

export const canUseWorkspace = (session: Session): boolean =>
	session.local || session.tenantId !== null;

export const adminMemberWriteSchema = z
	.object({ member: z.string().max(300) })
	.strict();

export const tenantMemberSchema = z.object({
	principal: z.string(),
	addedBy: z.string(),
	addedAt: z.number(),
});
export const adminDirectorySchema = z.object({
	tenants: z.array(
		tenantSummarySchema.extend({ members: z.array(tenantMemberSchema) }),
	),
	admins: z.array(
		z.object({
			principal: z.string(),
			source: z.enum(["environment", "database"]),
			createdBy: z.string().nullable(),
			createdAt: z.number().nullable(),
		}),
	),
});
export type AdminDirectory = z.infer<typeof adminDirectorySchema>;

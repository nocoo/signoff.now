import { type Session, sessionSchema } from "@signoff/domain/principal";
import { apiFetch, selectedTenant, storeTenant } from "@/lib/api";

/**
 * A stored tenant the caller can no longer use would deny every request, so
 * it is cleared and the session is read again with the server default.
 */
export async function loadSession(): Promise<Session> {
	const session = sessionSchema.parse(await apiFetch("/api/me"));
	const stored = selectedTenant();
	if (stored && session.tenantId === null && session.authenticated) {
		storeTenant(null);
		return sessionSchema.parse(await apiFetch("/api/me"));
	}
	return session;
}

export const displayName = (session: Session): string =>
	session.local
		? "Local"
		: (session.name ?? session.email ?? session.principal ?? "Signed out");

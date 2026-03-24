export type Platform = "github" | "azure-devops" | "unknown";

export interface RemoteInfo {
	platform: Platform;
	owner: string;
	repo: string;
}

export interface ResolvedIdentity {
	login: string;
	token: string;
	resolvedVia: "direct" | "org" | "fallback";
}

export interface GhAuthEntry {
	login: string;
	active: boolean;
	host: string;
}

export interface IdentityMapEntry {
	owner: string;
	ghUser: string;
}

export interface IdentityMapCache {
	entries: IdentityMapEntry[];
	createdAt: string; // ISO 8601
}

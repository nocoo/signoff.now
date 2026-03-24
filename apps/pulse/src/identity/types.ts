export type Platform = "github" | "azure-devops" | "unknown";

export interface RemoteInfo {
	platform: Platform;
	host: string;
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
	host: string;
	owner: string;
	ghUser: string;
}

export interface IdentityMapCache {
	entries: IdentityMapEntry[];
	createdAt: string; // ISO 8601
}

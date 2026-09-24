import type { Caller } from "./middleware/principal.js";

export type Bindings = {
	DB: D1Database;
	SIGNOFF_AI_ENCRYPTION_KEY?: string;
	/** Set only by the local dev command; also requires local trust. */
	SIGNOFF_DEMO_MODE?: string;
	/** Set only by local dev / E2E launchers; enables loopback trust. */
	SIGNOFF_LOCAL_TRUST?: string;
	/** Static assets (SPA / placeholder). */
	ASSETS?: Fetcher;
	/** Pipeline write token (ingest / recompute). */
	SIGNOFF_PIPELINE_WRITE_TOKEN?: string;
	/** Optional read token; falls back to write token when unset. */
	SIGNOFF_PIPELINE_READ_TOKEN?: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
	/** Comma-separated permanent admins (Worker secret; the repo is public). */
	SIGNOFF_ADMIN_EMAILS?: string;
};

export type Variables = {
	/** Set only after accessAuth successfully verifies JWT. */
	accessAuthenticated?: boolean;
	accessEmail?: string | null;
	accessName?: string | null;
	/** True when a service token authenticated, not a person. */
	accessService?: boolean;
	/** Set by resolvePrincipal for every /api request. */
	caller?: Caller;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

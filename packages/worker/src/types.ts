export type Bindings = {
	DB: D1Database;
	/** Pipeline write token (ingest / recompute). */
	SIGNOFF_PIPELINE_WRITE_TOKEN?: string;
	/** Optional read token; falls back to write token when unset. */
	SIGNOFF_PIPELINE_READ_TOKEN?: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
};

export type Variables = {
	/** Set only after accessAuth successfully verifies JWT. */
	accessAuthenticated?: boolean;
	accessEmail?: string | null;
	accessName?: string | null;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

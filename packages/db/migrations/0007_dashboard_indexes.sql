-- 0007: composite indexes for the Dashboard summary (08 §3.5).
--
-- Pure CREATE INDEX: no columns change, no table is rebuilt, so this applies
-- cleanly to a populated database with no guard.
--
-- Why: 0006 restored `day_key`, `type` and `config_version` as SEPARATE
-- indexes. Grouping activities by type within a date window therefore picks
-- `idx_activities_config_version` and scans every row of that version before
-- filtering dates — measured with EXPLAIN QUERY PLAN.

CREATE INDEX idx_activities_config_day_type ON activities (
	config_version,
	day_key,
	type
);

-- `lastIngestAt` reads MAX(finished_at) for finalized runs of the current
-- config. `idx_ingest_runs_started` orders by started_at and cannot serve it.
--
-- The DESC here is redundant (SQLite scans an ascending index backwards for
-- MAX) and 0008 drops it. This file is left exactly as applied: rewriting a
-- deployed migration makes the history lie about what actually ran.
CREATE INDEX idx_ingest_runs_config_status_finished ON ingest_runs (
	config_version,
	status,
	finished_at DESC
);

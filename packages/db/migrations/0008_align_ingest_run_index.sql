-- 0008: recreate the ingest-run index without a DESC ordering.
--
-- 0007 shipped `finished_at DESC`. It is not wrong — SQLite walks an ascending
-- index backwards for MAX() just as happily — but the deployed definition then
-- differs from what 0007 now says, and a schema you cannot read off the
-- migrations is a schema nobody will trust later.
--
-- Pure index work: no data is touched.

DROP INDEX IF EXISTS idx_ingest_runs_config_status_finished;

CREATE INDEX idx_ingest_runs_config_status_finished ON ingest_runs (
	config_version,
	status,
	finished_at
);

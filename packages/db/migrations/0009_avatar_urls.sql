-- 0009: optional avatar URLs for developers and teams.
--
-- Pure `ALTER TABLE ... ADD COLUMN` with a NULL default: SQLite rewrites no
-- rows and the column is absent from every existing INSERT, so this applies
-- cleanly to a populated database.
--
-- NULL means "no custom image" rather than "unknown". The UI then falls back to
-- a generated initial-on-colour avatar, which is why nothing here is NOT NULL:
-- an empty string would be a second way to say the same thing.

ALTER TABLE developers ADD COLUMN avatar_url TEXT;

ALTER TABLE teams ADD COLUMN avatar_url TEXT;

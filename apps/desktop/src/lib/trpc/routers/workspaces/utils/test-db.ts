/**
 * In-memory SQLite + Drizzle test helper.
 *
 * Creates a fresh in-memory database with the real schema for each test.
 * Uses Bun's built-in bun:sqlite driver instead of better-sqlite3 (native).
 */

import { Database } from "bun:sqlite";
import * as schema from "@signoff/local-db";
import { drizzle } from "drizzle-orm/bun-sqlite";

/** Raw SQL to create all tables — extracted from the migration file. */
const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS projects (
	id text PRIMARY KEY NOT NULL,
	main_repo_path text NOT NULL,
	name text NOT NULL,
	color text NOT NULL,
	tab_order integer,
	last_opened_at integer NOT NULL,
	created_at integer NOT NULL,
	config_toast_dismissed integer,
	default_branch text,
	workspace_base_branch text,
	github_owner text,
	branch_prefix_mode text,
	branch_prefix_custom text,
	worktree_base_dir text,
	hide_image integer,
	icon_url text,
	default_app text
);

CREATE INDEX IF NOT EXISTS projects_main_repo_path_idx ON projects (main_repo_path);
CREATE INDEX IF NOT EXISTS projects_last_opened_at_idx ON projects (last_opened_at);

CREATE TABLE IF NOT EXISTS worktrees (
	id text PRIMARY KEY NOT NULL,
	project_id text NOT NULL,
	path text NOT NULL,
	branch text NOT NULL,
	base_branch text,
	created_at integer NOT NULL,
	git_status text,
	github_status text,
	FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS worktrees_project_id_idx ON worktrees (project_id);
CREATE INDEX IF NOT EXISTS worktrees_branch_idx ON worktrees (branch);

CREATE TABLE IF NOT EXISTS workspace_sections (
	id text PRIMARY KEY NOT NULL,
	project_id text NOT NULL,
	name text NOT NULL,
	tab_order integer NOT NULL,
	is_collapsed integer DEFAULT 0,
	color text,
	created_at integer NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS workspace_sections_project_id_idx ON workspace_sections (project_id);

CREATE TABLE IF NOT EXISTS workspaces (
	id text PRIMARY KEY NOT NULL,
	project_id text NOT NULL,
	worktree_id text,
	type text NOT NULL,
	branch text NOT NULL,
	name text NOT NULL,
	tab_order integer NOT NULL,
	created_at integer NOT NULL,
	updated_at integer NOT NULL,
	last_opened_at integer NOT NULL,
	is_unread integer DEFAULT 0,
	is_unnamed integer DEFAULT 0,
	deleting_at integer,
	port_base integer,
	section_id text,
	FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (section_id) REFERENCES workspace_sections(id) ON UPDATE no action ON DELETE set null
);

CREATE INDEX IF NOT EXISTS workspaces_project_id_idx ON workspaces (project_id);
CREATE INDEX IF NOT EXISTS workspaces_worktree_id_idx ON workspaces (worktree_id);
CREATE INDEX IF NOT EXISTS workspaces_last_opened_at_idx ON workspaces (last_opened_at);
CREATE INDEX IF NOT EXISTS workspaces_section_id_idx ON workspaces (section_id);

CREATE TABLE IF NOT EXISTS settings (
	id integer PRIMARY KEY DEFAULT 1 NOT NULL,
	last_active_workspace_id text,
	terminal_presets text,
	terminal_presets_initialized integer,
	confirm_on_quit integer,
	terminal_link_behavior text,
	persist_terminal integer DEFAULT 1,
	auto_apply_default_preset integer,
	branch_prefix_mode text,
	branch_prefix_custom text,
	delete_local_branch integer,
	file_open_mode text,
	show_presets_bar integer,
	use_compact_terminal_add_button integer,
	terminal_font_family text,
	terminal_font_size integer,
	editor_font_family text,
	editor_font_size integer,
	worktree_base_dir text,
	open_links_in_app integer,
	default_editor text
);
`;

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a fresh in-memory database with the full schema.
 * Returns both the Drizzle instance and a cleanup function.
 */
export function createTestDb(): {
	db: TestDb;
	sqlite: Database;
	cleanup: () => void;
} {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA foreign_keys = ON");
	sqlite.exec(CREATE_TABLES_SQL);

	// Insert default settings row
	sqlite.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)");

	const db = drizzle(sqlite, { schema });

	return {
		db,
		sqlite,
		cleanup: () => {
			sqlite.close();
		},
	};
}

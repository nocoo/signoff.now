import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v4 as uuidv4 } from "uuid";

import type {
	BranchPrefixMode,
	ExternalApp,
	FileOpenMode,
	GitHubStatus,
	GitStatus,
	TerminalLinkBehavior,
	TerminalPreset,
	WorkspaceType,
} from "./zod";

/**
 * Projects table - represents a git repository that the user has opened
 */
export const projects = sqliteTable(
	"projects",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		mainRepoPath: text("main_repo_path").notNull(),
		name: text("name").notNull(),
		color: text("color").notNull(),
		tabOrder: integer("tab_order"),
		lastOpenedAt: integer("last_opened_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		configToastDismissed: integer("config_toast_dismissed", {
			mode: "boolean",
		}),
		defaultBranch: text("default_branch"),
		workspaceBaseBranch: text("workspace_base_branch"),
		githubOwner: text("github_owner"),
		branchPrefixMode: text("branch_prefix_mode").$type<BranchPrefixMode>(),
		branchPrefixCustom: text("branch_prefix_custom"),
		worktreeBaseDir: text("worktree_base_dir"),
		hideImage: integer("hide_image", { mode: "boolean" }),
		iconUrl: text("icon_url"),
		defaultApp: text("default_app").$type<ExternalApp>(),
	},
	(table) => [
		index("projects_main_repo_path_idx").on(table.mainRepoPath),
		index("projects_last_opened_at_idx").on(table.lastOpenedAt),
	],
);

export type InsertProject = typeof projects.$inferInsert;
export type SelectProject = typeof projects.$inferSelect;

/**
 * Worktrees table - represents a git worktree within a project
 */
export const worktrees = sqliteTable(
	"worktrees",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		branch: text("branch").notNull(),
		baseBranch: text("base_branch"), // The branch this worktree was created from
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		gitStatus: text("git_status", { mode: "json" }).$type<GitStatus>(),
		githubStatus: text("github_status", { mode: "json" }).$type<GitHubStatus>(),
	},
	(table) => [
		index("worktrees_project_id_idx").on(table.projectId),
		index("worktrees_branch_idx").on(table.branch),
	],
);

export type InsertWorktree = typeof worktrees.$inferInsert;
export type SelectWorktree = typeof worktrees.$inferSelect;

/**
 * Workspaces table - represents an active workspace (worktree or branch-based)
 */
export const workspaces = sqliteTable(
	"workspaces",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		worktreeId: text("worktree_id").references(() => worktrees.id, {
			onDelete: "cascade",
		}), // Only set for type="worktree"
		type: text("type").notNull().$type<WorkspaceType>(),
		branch: text("branch").notNull(), // Branch name for both types
		name: text("name").notNull(),
		tabOrder: integer("tab_order").notNull(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		lastOpenedAt: integer("last_opened_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		isUnread: integer("is_unread", { mode: "boolean" }).default(false),
		// Whether the workspace has an auto-generated name (branch name) that should prompt for rename
		isUnnamed: integer("is_unnamed", { mode: "boolean" }).default(false),
		// Timestamp when deletion was initiated. Non-null means deletion in progress.
		// Workspaces with deletingAt set should be filtered out from queries.
		deletingAt: integer("deleting_at"),
		// Allocated port base for multi-worktree dev instances.
		// Each workspace gets a range of 10 ports starting from this base.
		portBase: integer("port_base"),
		sectionId: text("section_id").references(() => workspaceSections.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("workspaces_project_id_idx").on(table.projectId),
		index("workspaces_worktree_id_idx").on(table.worktreeId),
		index("workspaces_last_opened_at_idx").on(table.lastOpenedAt),
		index("workspaces_section_id_idx").on(table.sectionId),
		// NOTE: Migration 0006 creates an additional partial unique index:
		// CREATE UNIQUE INDEX workspaces_unique_branch_per_project
		//   ON workspaces(project_id) WHERE type = 'branch'
		// This enforces one branch workspace per project. Drizzle's schema DSL
		// doesn't support partial/filtered indexes, so this constraint is only
		// applied via the migration, not schema push. See migration 0006 for details.
	],
);

export type InsertWorkspace = typeof workspaces.$inferInsert;
export type SelectWorkspace = typeof workspaces.$inferSelect;

/**
 * Workspace sections - user-created groups within a project for organizing workspaces
 */
export const workspaceSections = sqliteTable(
	"workspace_sections",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		tabOrder: integer("tab_order").notNull(),
		isCollapsed: integer("is_collapsed", { mode: "boolean" }).default(false),
		color: text("color"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [index("workspace_sections_project_id_idx").on(table.projectId)],
);

export type InsertWorkspaceSection = typeof workspaceSections.$inferInsert;
export type SelectWorkspaceSection = typeof workspaceSections.$inferSelect;

export const settings = sqliteTable("settings", {
	id: integer("id").primaryKey().default(1),
	lastActiveWorkspaceId: text("last_active_workspace_id"),
	terminalPresets: text("terminal_presets", { mode: "json" }).$type<
		TerminalPreset[]
	>(),
	terminalPresetsInitialized: integer("terminal_presets_initialized", {
		mode: "boolean",
	}),
	confirmOnQuit: integer("confirm_on_quit", { mode: "boolean" }),
	terminalLinkBehavior: text(
		"terminal_link_behavior",
	).$type<TerminalLinkBehavior>(),
	terminalPersistence: integer("persist_terminal", { mode: "boolean" }).default(
		true,
	),
	autoApplyDefaultPreset: integer("auto_apply_default_preset", {
		mode: "boolean",
	}),
	branchPrefixMode: text("branch_prefix_mode").$type<BranchPrefixMode>(),
	branchPrefixCustom: text("branch_prefix_custom"),
	deleteLocalBranch: integer("delete_local_branch", { mode: "boolean" }),
	fileOpenMode: text("file_open_mode").$type<FileOpenMode>(),
	showPresetsBar: integer("show_presets_bar", { mode: "boolean" }),
	useCompactTerminalAddButton: integer("use_compact_terminal_add_button", {
		mode: "boolean",
	}),
	terminalFontFamily: text("terminal_font_family"),
	terminalFontSize: integer("terminal_font_size"),
	editorFontFamily: text("editor_font_family"),
	editorFontSize: integer("editor_font_size"),
	worktreeBaseDir: text("worktree_base_dir"),
	openLinksInApp: integer("open_links_in_app", { mode: "boolean" }),
	defaultEditor: text("default_editor").$type<ExternalApp>(),
	customHotkeys: text("custom_hotkeys", { mode: "json" }).$type<
		Record<string, string>
	>(),
});

export type InsertSettings = typeof settings.$inferInsert;
export type SelectSettings = typeof settings.$inferSelect;

// ---------------------------------------------------------------------------
// Pull request cache tables
// ---------------------------------------------------------------------------

/**
 * JSON column types for pull_request_details sub-entity arrays.
 * Defined locally to keep local-db free of @signoff/pulse dependency.
 * These mirror the types in @signoff/pulse/commands/types.ts.
 */

/** A single review on a PR. */
interface PrReviewJson {
	author: string;
	state:
		| "APPROVED"
		| "CHANGES_REQUESTED"
		| "COMMENTED"
		| "DISMISSED"
		| "PENDING";
	body: string;
	submittedAt: string | null;
}

/** An issue comment (non-review). */
interface PrCommentJson {
	author: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

/** A commit in the PR. */
interface PrCommitJson {
	oid: string;
	message: string;
	author: string;
	authoredDate: string;
	statusCheckRollup:
		| "SUCCESS"
		| "FAILURE"
		| "PENDING"
		| "ERROR"
		| "EXPECTED"
		| null;
}

/** A changed file in the PR. */
interface PrFileJson {
	path: string;
	additions: number;
	deletions: number;
	changeType:
		| "ADDED"
		| "MODIFIED"
		| "DELETED"
		| "RENAMED"
		| "COPIED"
		| "CHANGED";
}

/**
 * Pull requests table — list-level cache.
 *
 * Stores every PR seen during list scans. Upserted in batches of 20 per page.
 * UNIQUE on (project_id, number) enables ON CONFLICT DO UPDATE.
 */
export const pullRequests = sqliteTable(
	"pull_requests",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),

		// PR metadata — field names align with PullRequestInfo from @signoff/pulse
		title: text("title").notNull(),
		state: text("state").notNull(), // "open" | "closed"
		draft: integer("draft", { mode: "boolean" }).notNull(),
		merged: integer("merged", { mode: "boolean" }).notNull(),
		mergedAt: text("merged_at"), // ISO 8601 | null
		author: text("author").notNull(),
		createdAt: text("created_at").notNull(), // ISO 8601 (PR creation)
		updatedAt: text("updated_at").notNull(), // ISO 8601 (PR update)
		closedAt: text("closed_at"), // ISO 8601 | null
		headBranch: text("head_branch").notNull(),
		baseBranch: text("base_branch").notNull(),
		url: text("url").notNull(),
		labels: text("labels", { mode: "json" }).$type<string[]>().notNull(),
		reviewDecision: text("review_decision"), // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
		additions: integer("additions").notNull(),
		deletions: integer("deletions").notNull(),
		changedFiles: integer("changed_files").notNull(),

		// Cache bookkeeping
		fetchedAt: integer("fetched_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		uniqueIndex("pull_requests_project_number_uniq").on(
			table.projectId,
			table.number,
		),
		index("pull_requests_project_state_idx").on(table.projectId, table.state),
	],
);

export type InsertPullRequest = typeof pullRequests.$inferInsert;
export type SelectPullRequest = typeof pullRequests.$inferSelect;

/**
 * Pull request details table — detail-level cache.
 *
 * Stores the heavy payload fetched on demand when user clicks a PR.
 * One row per PR. Sub-entity arrays stored as JSON columns.
 * UNIQUE on (project_id, number) enables ON CONFLICT DO UPDATE.
 */
export const pullRequestDetails = sqliteTable(
	"pull_request_details",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),

		// Detail-only scalar fields — names align with PrDetail from @signoff/pulse
		body: text("body").notNull(), // PR description markdown
		mergeable: text("mergeable").notNull(), // MERGEABLE | CONFLICTING | UNKNOWN
		mergeStateStatus: text("merge_state_status").notNull(),
		mergedBy: text("merged_by"), // login | null
		totalCommentsCount: integer("total_comments_count").notNull(),
		headRefOid: text("head_ref_oid").notNull(),
		baseRefOid: text("base_ref_oid").notNull(),
		isCrossRepository: integer("is_cross_repository", {
			mode: "boolean",
		}).notNull(),

		// Array fields as JSON
		participants: text("participants", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		requestedReviewers: text("requested_reviewers", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		assignees: text("assignees", { mode: "json" }).$type<string[]>().notNull(),
		milestone: text("milestone"), // title string | null

		// Sub-entity arrays as JSON (read-only display, no SQL querying needed)
		reviews: text("reviews", { mode: "json" })
			.$type<PrReviewJson[]>()
			.notNull(),
		comments: text("comments", { mode: "json" })
			.$type<PrCommentJson[]>()
			.notNull(),
		commits: text("commits", { mode: "json" })
			.$type<PrCommitJson[]>()
			.notNull(),
		files: text("files", { mode: "json" }).$type<PrFileJson[]>().notNull(),

		// Cache bookkeeping
		fetchedAt: integer("fetched_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		uniqueIndex("pr_details_project_number_uniq").on(
			table.projectId,
			table.number,
		),
	],
);

export type InsertPullRequestDetail = typeof pullRequestDetails.$inferInsert;
export type SelectPullRequestDetail = typeof pullRequestDetails.$inferSelect;

/**
 * Pull request scans table — pagination & scan metadata.
 *
 * Tracks scan state per project. One row per project (single canonical
 * scan chain — always state:"all" from GitHub).
 * UNIQUE on (project_id) ensures one scan record per project.
 */
export const pullRequestScans = sqliteTable(
	"pull_request_scans",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => uuidv4()),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),

		// Pagination state (from latest GitHub response)
		endCursor: text("end_cursor"), // GitHub GraphQL cursor
		hasNextPage: integer("has_next_page", { mode: "boolean" }).notNull(),

		// Identity info (for display)
		resolvedUser: text("resolved_user"),
		resolvedVia: text("resolved_via"), // "direct" | "org" | "fallback"

		// Repository info
		repoOwner: text("repo_owner"),
		repoName: text("repo_name"),

		// Timestamps
		scannedAt: integer("scanned_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [uniqueIndex("pr_scans_project_uniq").on(table.projectId)],
);

export type InsertPullRequestScan = typeof pullRequestScans.$inferInsert;
export type SelectPullRequestScan = typeof pullRequestScans.$inferSelect;

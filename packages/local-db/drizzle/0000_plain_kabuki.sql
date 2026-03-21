CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`main_repo_path` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`tab_order` integer,
	`last_opened_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`config_toast_dismissed` integer,
	`default_branch` text,
	`workspace_base_branch` text,
	`github_owner` text,
	`branch_prefix_mode` text,
	`branch_prefix_custom` text,
	`worktree_base_dir` text,
	`hide_image` integer,
	`icon_url` text,
	`default_app` text
);
--> statement-breakpoint
CREATE INDEX `projects_main_repo_path_idx` ON `projects` (`main_repo_path`);--> statement-breakpoint
CREATE INDEX `projects_last_opened_at_idx` ON `projects` (`last_opened_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`last_active_workspace_id` text,
	`terminal_presets` text,
	`terminal_presets_initialized` integer,
	`confirm_on_quit` integer,
	`terminal_link_behavior` text,
	`persist_terminal` integer DEFAULT true,
	`auto_apply_default_preset` integer,
	`branch_prefix_mode` text,
	`branch_prefix_custom` text,
	`delete_local_branch` integer,
	`file_open_mode` text,
	`show_presets_bar` integer,
	`use_compact_terminal_add_button` integer,
	`terminal_font_family` text,
	`terminal_font_size` integer,
	`editor_font_family` text,
	`editor_font_size` integer,
	`worktree_base_dir` text,
	`open_links_in_app` integer,
	`default_editor` text
);
--> statement-breakpoint
CREATE TABLE `workspace_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`tab_order` integer NOT NULL,
	`is_collapsed` integer DEFAULT false,
	`color` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_sections_project_id_idx` ON `workspace_sections` (`project_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`worktree_id` text,
	`type` text NOT NULL,
	`branch` text NOT NULL,
	`name` text NOT NULL,
	`tab_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_opened_at` integer NOT NULL,
	`is_unread` integer DEFAULT false,
	`is_unnamed` integer DEFAULT false,
	`deleting_at` integer,
	`port_base` integer,
	`section_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `workspace_sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspaces_project_id_idx` ON `workspaces` (`project_id`);--> statement-breakpoint
CREATE INDEX `workspaces_worktree_id_idx` ON `workspaces` (`worktree_id`);--> statement-breakpoint
CREATE INDEX `workspaces_last_opened_at_idx` ON `workspaces` (`last_opened_at`);--> statement-breakpoint
CREATE INDEX `workspaces_section_id_idx` ON `workspaces` (`section_id`);--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text,
	`created_at` integer NOT NULL,
	`git_status` text,
	`github_status` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `worktrees_project_id_idx` ON `worktrees` (`project_id`);--> statement-breakpoint
CREATE INDEX `worktrees_branch_idx` ON `worktrees` (`branch`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_unique_branch_per_project` ON `workspaces` (`project_id`) WHERE `type` = 'branch';
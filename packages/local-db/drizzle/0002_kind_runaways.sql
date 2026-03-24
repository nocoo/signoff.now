CREATE TABLE `pull_request_details` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`body` text NOT NULL,
	`mergeable` text NOT NULL,
	`merge_state_status` text NOT NULL,
	`merged_by` text,
	`total_comments_count` integer NOT NULL,
	`head_ref_oid` text NOT NULL,
	`base_ref_oid` text NOT NULL,
	`is_cross_repository` integer NOT NULL,
	`participants` text NOT NULL,
	`requested_reviewers` text NOT NULL,
	`assignees` text NOT NULL,
	`milestone` text,
	`reviews` text NOT NULL,
	`comments` text NOT NULL,
	`commits` text NOT NULL,
	`files` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_details_project_number_uniq` ON `pull_request_details` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `pull_request_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`end_cursor` text,
	`has_next_page` integer NOT NULL,
	`resolved_user` text,
	`resolved_via` text,
	`repo_owner` text,
	`repo_name` text,
	`scanned_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_scans_project_uniq` ON `pull_request_scans` (`project_id`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`draft` integer NOT NULL,
	`merged` integer NOT NULL,
	`merged_at` text,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	`head_branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`url` text NOT NULL,
	`labels` text NOT NULL,
	`review_decision` text,
	`additions` integer NOT NULL,
	`deletions` integer NOT NULL,
	`changed_files` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_project_number_uniq` ON `pull_requests` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `pull_requests_project_state_idx` ON `pull_requests` (`project_id`,`state`);
import { relations } from "drizzle-orm";
import {
	projects,
	pullRequestDetails,
	pullRequestScans,
	pullRequests,
	workspaceSections,
	workspaces,
	worktrees,
} from "./schema";

export const projectsRelations = relations(projects, ({ many }) => ({
	worktrees: many(worktrees),
	workspaces: many(workspaces),
	workspaceSections: many(workspaceSections),
	pullRequests: many(pullRequests),
	pullRequestDetails: many(pullRequestDetails),
	pullRequestScans: many(pullRequestScans),
}));

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
	project: one(projects, {
		fields: [worktrees.projectId],
		references: [projects.id],
	}),
	workspaces: many(workspaces),
}));

export const workspacesRelations = relations(workspaces, ({ one }) => ({
	project: one(projects, {
		fields: [workspaces.projectId],
		references: [projects.id],
	}),
	worktree: one(worktrees, {
		fields: [workspaces.worktreeId],
		references: [worktrees.id],
	}),
	section: one(workspaceSections, {
		fields: [workspaces.sectionId],
		references: [workspaceSections.id],
	}),
}));

export const workspaceSectionsRelations = relations(
	workspaceSections,
	({ one, many }) => ({
		project: one(projects, {
			fields: [workspaceSections.projectId],
			references: [projects.id],
		}),
		workspaces: many(workspaces),
	}),
);

export const pullRequestsRelations = relations(pullRequests, ({ one }) => ({
	project: one(projects, {
		fields: [pullRequests.projectId],
		references: [projects.id],
	}),
}));

export const pullRequestDetailsRelations = relations(
	pullRequestDetails,
	({ one }) => ({
		project: one(projects, {
			fields: [pullRequestDetails.projectId],
			references: [projects.id],
		}),
	}),
);

export const pullRequestScansRelations = relations(
	pullRequestScans,
	({ one }) => ({
		project: one(projects, {
			fields: [pullRequestScans.projectId],
			references: [projects.id],
		}),
	}),
);

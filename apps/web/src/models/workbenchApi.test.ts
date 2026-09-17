import { demoWorkspace } from "@signoff/domain/demo";
import type { ProjectWrite } from "@signoff/domain/workbench";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	createProject,
	deleteProject,
	loadWorkbench,
	patchProject,
	patchReadiness,
	patchRefreshSettings,
	scanProject,
	updateCollectionView,
} from "./workbenchApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const demo = demoWorkspace(1_800_000_000);
const snapshot = {
	...demo,
	fetchedAt: 1_800_000_000,
	demoMode: true,
	truncated: false,
};
const draft: ProjectWrite = {
	provider: "ado",
	name: "Core",
	organization: "northstar",
	projectKey: "Platform",
	owner: "Maya",
	description: "Services",
	enabled: true,
};

beforeEach(() => {
	vi.mocked(apiFetch).mockReset();
});

describe("workbench HTTP contract", () => {
	it("writes cooldowns independently and sends sequenced foreground updates with a keepalive hide", async () => {
		const queues = [
			{
				kind: "list",
				cooldownSeconds: 120,
				lastCompletedAt: null,
				roundId: null,
				requested: false,
				foregroundUntil: 0,
				totalJobs: 0,
				completedJobs: 0,
			},
		];
		vi.mocked(apiFetch).mockResolvedValue(queues);
		expect(await patchRefreshSettings({ detailCooldownSeconds: 600 })).toEqual(
			queues,
		);
		expect(apiFetch).toHaveBeenLastCalledWith("/api/collection/settings", {
			method: "PATCH",
			body: '{"detailCooldownSeconds":600}',
		});
		const view = {
			viewId: "54e0ad34-8504-49ec-9a1d-1bb0543552cc",
			sequence: 2,
			visible: false,
			refresh: false,
			pageKey: "first",
			pullIds: [],
		};
		await updateCollectionView(view);
		expect(apiFetch).toHaveBeenLastCalledWith(
			"/api/collection/view",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify(view),
				keepalive: true,
			}),
		);
		vi.mocked(apiFetch).mockResolvedValue([
			{ ...queues[0], cooldownSeconds: -1 },
		]);
		await expect(
			patchRefreshSettings({ listCooldownSeconds: 120 }),
		).rejects.toThrow();
	});
	it("saves readiness with its own revision and validates the returned settings", async () => {
		const saved = {
			...demo.projects[0],
			readinessRules: [],
			readinessRevision: 3,
		};
		vi.mocked(apiFetch).mockResolvedValue(saved);
		expect(await patchReadiness("p /?#", 2, [])).toEqual(saved);
		expect(apiFetch).toHaveBeenCalledWith(
			"/api/projects/p%20%2F%3F%23/readiness",
			{ method: "PATCH", body: '{"revision":2,"rules":[]}' },
		);
		vi.mocked(apiFetch).mockResolvedValue({ ...saved, readinessRevision: 0 });
		await expect(patchReadiness("p", 2, [])).rejects.toThrow();
	});
	it("accepts a queued live job as a pending scan result", async () => {
		const job = {
			id: "job",
			projectId: "p",
			revision: 1,
			state: "queued",
			requestedAt: 100,
			startedAt: null,
			updatedAt: 100,
			completedAt: null,
			completedPulls: 0,
			totalPulls: null,
			message: "Waiting",
		};
		vi.mocked(apiFetch).mockResolvedValue(job);
		expect(await scanProject("p", 1)).toEqual(job);
	});
	it("reads and validates the complete normalized snapshot", async () => {
		vi.mocked(apiFetch).mockResolvedValue(snapshot);
		expect(await loadWorkbench()).toEqual(snapshot);
		expect(apiFetch).toHaveBeenCalledWith("/api/workbench");
		vi.mocked(apiFetch).mockResolvedValue({
			...snapshot,
			pullRequests: [{ ...demo.pullRequests[0], state: "not-a-state" }],
		});
		await expect(loadWorkbench()).rejects.toThrow();
	});
	it("creates a project without choosing the server-owned source or revision", async () => {
		vi.mocked(apiFetch).mockResolvedValue(demo.projects[0]);
		expect(await createProject(draft)).toEqual(demo.projects[0]);
		expect(apiFetch).toHaveBeenCalledWith("/api/projects", {
			method: "POST",
			body: JSON.stringify(draft),
		});
	});
	it("encodes project identities and sends only the patch with its revision", async () => {
		vi.mocked(apiFetch).mockResolvedValue(demo.projects[0]);
		await patchProject("p /?#", { enabled: false, revision: 7 });
		expect(apiFetch).toHaveBeenCalledWith("/api/projects/p%20%2F%3F%23", {
			method: "PATCH",
			body: '{"enabled":false,"revision":7}',
		});
	});
	it("deletes only the version the user reviewed", async () => {
		vi.mocked(apiFetch).mockResolvedValue({ ok: true });
		await deleteProject("p /?#", 8);
		expect(apiFetch).toHaveBeenCalledWith("/api/projects/p%20%2F%3F%23", {
			method: "DELETE",
			body: '{"revision":8}',
		});
	});
	it("uses the scan endpoint and validates the returned stage progress", async () => {
		vi.mocked(apiFetch).mockResolvedValue(demo.scans[0]);
		expect(await scanProject("p /?#", 9)).toEqual(demo.scans[0]);
		expect(apiFetch).toHaveBeenCalledWith("/api/projects/p%20%2F%3F%23/scan", {
			method: "POST",
			body: '{"revision":9}',
		});
		vi.mocked(apiFetch).mockResolvedValue({
			...demo.scans[0],
			advancedStages: -1,
		});
		await expect(scanProject("p", 9)).rejects.toThrow();
	});
	it("propagates concurrency errors without inventing a successful result", async () => {
		vi.mocked(apiFetch).mockRejectedValue(
			new Error("This project changed. Refresh and try again."),
		);
		await expect(
			patchProject("p", { revision: 1, name: "New name" }),
		).rejects.toThrow("This project changed");
		vi.mocked(apiFetch).mockResolvedValue({ id: "invalid" });
		await expect(createProject(draft)).rejects.toThrow();
	});
});

import { describe, expect, test } from "vitest";
import {
	parseDeveloper,
	parseRepo,
	parseTag,
	parseTeam,
	validateDeveloperInput,
} from "./entities";

describe("parseDeveloper", () => {
	test("maps fields", () => {
		const d = parseDeveloper({
			id: "1",
			name: "Ada",
			alias: "ada",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(d.alias).toBe("ada");
		expect(d.archivedAt).toBeNull();
	});

	test("maps archivedAt", () => {
		const d = parseDeveloper({
			id: "1",
			name: "Ada",
			alias: "ada",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: 99,
		});
		expect(d.archivedAt).toBe(99);
	});
});

describe("parseTeam / parseTag / parseRepo", () => {
	test("team", () => {
		const t = parseTeam({
			id: "t",
			name: "Core",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(t.name).toBe("Core");
	});

	test("tag", () => {
		const t = parseTag({
			id: "g",
			name: "fe",
			color: "#FFFFFF",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(t.color).toBe("#FFFFFF");
	});

	test("repo", () => {
		const r = parseRepo({
			id: "r",
			provider: "ado",
			org: "o",
			project: "p",
			name: "n",
			remoteUrl: null,
			externalId: "guid",
			projectExternalId: "pg-guid",
			enabled: true,
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(r.externalId).toBe("guid");
		expect(r.projectExternalId).toBe("pg-guid");
		expect(r.enabled).toBe(true);
	});

	test("archived team/tag/repo", () => {
		expect(
			parseTeam({
				id: "t",
				name: "X",
				createdAt: 1,
				updatedAt: 2,
				archivedAt: 5,
			}).archivedAt,
		).toBe(5);
		expect(
			parseTag({
				id: "g",
				name: "x",
				color: "#000000",
				createdAt: 1,
				updatedAt: 2,
				archivedAt: 6,
			}).archivedAt,
		).toBe(6);
		const r = parseRepo({
			id: "r",
			provider: "ado",
			org: "o",
			project: "p",
			name: "n",
			remoteUrl: "https://example.com",
			externalId: null,
			projectExternalId: null,
			enabled: false,
			createdAt: 1,
			updatedAt: 2,
			archivedAt: 7,
		});
		expect(r.archivedAt).toBe(7);
		expect(r.remoteUrl).toBe("https://example.com");
		expect(r.projectExternalId).toBeNull();
		expect(r.enabled).toBe(false);
	});
});

describe("validateDeveloperInput", () => {
	test("rejects empty", () => {
		expect(validateDeveloperInput("", "a")).toMatch(/Name/);
		expect(validateDeveloperInput("A", "a@b")).toMatch(/Alias/);
		expect(validateDeveloperInput("A", "ada")).toBeNull();
	});
});

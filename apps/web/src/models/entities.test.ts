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
			enabled: true,
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(r.externalId).toBe("guid");
		expect(r.enabled).toBe(true);
	});
});

describe("validateDeveloperInput", () => {
	test("rejects empty", () => {
		expect(validateDeveloperInput("", "a")).toMatch(/Name/);
		expect(validateDeveloperInput("A", "a@b")).toMatch(/Alias/);
		expect(validateDeveloperInput("A", "ada")).toBeNull();
	});
});

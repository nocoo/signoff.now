import { expect, mock, test } from "bun:test";
import type { FetchFn } from "../ado/client";
import { createAdoClient } from "../ado/client";
import { adoRequestKind, measuredAdoFetch } from "./network";

test("ADO URLs cover discovery, metadata, reviews and checks without storing URLs", () => {
	for (const path of [
		"git/repositories",
		"git/repositories/r/pullrequests",
		"connectionData",
	])
		expect(
			adoRequestKind(
				`https://dev.azure.com/o/p/_apis/${path}?secret=never-store`,
			),
		).toBe("adoDiscovery");
	for (const path of [
		"git/repositories/r/pullRequests/12",
		"git/repositories/r/pullrequests/12/threads",
		"git/repositories/r/pullrequests/12/iterations/2/changes",
	])
		expect(adoRequestKind(`https://dev.azure.com/o/p/_apis/${path}`)).toBe(
			"adoDetails",
		);
	for (const path of [
		"build/builds/1/timeline",
		"policy/evaluations",
		"git/repositories/r/pullRequests/12/statuses",
	])
		expect(adoRequestKind(`https://dev.azure.com/o/p/_apis/${path}`)).toBe(
			"adoChecks",
		);
});
test("every real retry is counted; telemetry failure preserves HTTP response and transport error", async () => {
	const report = mock(async () => {});
	const warn = mock(() => {});
	const fetcher = mock<FetchFn>()
		.mockResolvedValueOnce(new Response("", { status: 503 }))
		.mockResolvedValueOnce(new Response("{}"));
	const ado = createAdoClient({
		exec: async () => ({
			exitCode: 0,
			stdout: JSON.stringify({ accessToken: "test", expiresOn: "2099-01-01" }),
			stderr: "",
		}),
		fetchFn: measuredAdoFetch(fetcher, report, warn),
		sleep: async () => {},
		jitterMs: () => 0,
	});
	await ado.get("https://dev.azure.com/o/p/_apis/policy/evaluations");
	expect(report).toHaveBeenCalledTimes(2);
	expect(report.mock.calls[0]).not.toEqual(report.mock.calls[1]);
	const failingReport = mock(async () => {
		throw new Error("telemetry unavailable");
	});
	const measured = measuredAdoFetch(
		mock<FetchFn>()
			.mockResolvedValueOnce(new Response("ok"))
			.mockRejectedValueOnce(new Error("offline")),
		failingReport,
		warn,
	);
	expect((await measured("https://dev.azure.com")).status).toBe(200);
	await expect(measured("https://dev.azure.com")).rejects.toThrow("offline");
	expect(warn).toHaveBeenCalledTimes(2);
});

import { expect, mock, spyOn, test } from "bun:test";
import { CLASSIFICATION, JEV_MODEL } from "@signoff/domain/ai-readiness";
import { measuredJevFetch, queryNetwork } from "../monitoring/network";
import { createSqliteD1 } from "../test/sqlite-d1";
import { evaluateJev, JEV_QUESTIONS } from "./jev";

const now = 1_790_200_800;
const result = () => ({
	model: JEV_MODEL,
	usage: { input_tokens: 10, output_tokens: 5 },
	answers: {
		readiness: {
			type: "choice",
			choice: "running",
			probabilities: Object.fromEntries(
				Object.keys(CLASSIFICATION).map((key) => [
					key,
					Number(key === "running"),
				]),
			),
			confidence: 1,
		},
	},
});
const transport = (
	callback: (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response> | Response,
): typeof fetch =>
	Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) =>
			callback(input, init),
		{ preconnect: fetch.preconnect },
	);

test("uses the official SDK identity, exact endpoint and model, 30-second deadline, and manual redirects", async () => {
	const timer = spyOn(globalThis, "setTimeout");
	const send = mock((input: RequestInfo | URL, init?: RequestInit) => {
		expect(input).toBe("https://api.typesafe.ai/v1/systemone");
		const headers = new Headers(
			(init?.headers ?? {}) as Record<string, string>,
		);
		expect(headers.get("authorization")).toBe("Bearer private-key");
		expect(headers.get("user-agent")).toBe("typesafe-sdk/0.6.0");
		expect(headers.get("x-typesafe-sdk")).toBe("typesafe-sdk/0.6.0");
		expect(headers.get("x-typesafe-runtime")).toBeTruthy();
		expect(headers.get("accept")).toBe("application/json");
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.has("x-typesafe-retry-count")).toBe(false);
		expect(init?.redirect).toBe("manual");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(String(init?.body))).toEqual({
			model: JEV_MODEL,
			state: { synthetic: true },
			questions: JEV_QUESTIONS,
		});
		return Response.json(result());
	});
	try {
		const answer = await evaluateJev(
			"private-key",
			{ synthetic: true },
			"fingerprint",
			now,
			transport(send),
		);
		expect(answer.result).toMatchObject({
			kind: "running",
			model: JEV_MODEL,
			fingerprint: "fingerprint",
		});
		expect(timer.mock.calls.some((call) => call[1] === 30000)).toBe(true);
		expect(send).toHaveBeenCalledTimes(1);
	} finally {
		timer.mockRestore();
	}
});

test.each([
	429, 500,
])("SDK does not retry HTTP %s; network measurement and retry-after stay with the scheduler", async (status) => {
	const db = createSqliteD1();
	const send = mock(
		() =>
			new Response("private-key upstream details", {
				status,
				headers: { "retry-after": "7" },
			}),
	);
	try {
		await expect(
			evaluateJev(
				"private-key",
				{},
				"fingerprint",
				now,
				measuredJevFetch(db.db, transport(send)),
			),
		).rejects.toMatchObject({
			code: `http_${status}`,
			transient: true,
			retryAfter: 7,
		});
		expect(send).toHaveBeenCalledTimes(1);
		expect(
			(await queryNetwork(db.db, Math.floor(Date.now() / 1000))).buckets.reduce(
				(total, bucket) => total + bucket.jev,
				0,
			),
		).toBe(1);
	} finally {
		db.close();
	}
});

test("SDK does not retry transport errors and never exposes their private details", async () => {
	const send = mock(() => {
		throw new Error("private-key upstream details");
	});
	await expect(
		evaluateJev("private-key", {}, "fingerprint", now, transport(send)),
	).rejects.toMatchObject({
		code: "transport",
		message: "Jev could not be reached within 30 seconds.",
		transient: true,
	});
	expect(send).toHaveBeenCalledTimes(1);
});

test("SDK logging is disabled even when the environment enables body logging", async () => {
	const previous = process.env.TYPESAFE_LOG_LEVEL;
	process.env.TYPESAFE_LOG_LEVEL = "debug";
	const loggers = [
		spyOn(console, "debug"),
		spyOn(console, "info"),
		spyOn(console, "warn"),
		spyOn(console, "error"),
	];
	try {
		await evaluateJev(
			"private-key",
			{ private: "evidence" },
			"fingerprint",
			now,
			transport(() => Response.json(result())),
		);
		for (const logger of loggers) expect(logger).not.toHaveBeenCalled();
	} finally {
		for (const logger of loggers) logger.mockRestore();
		if (previous === undefined) delete process.env.TYPESAFE_LOG_LEVEL;
		else process.env.TYPESAFE_LOG_LEVEL = previous;
	}
});

test("rejects oversized UTF-8 evidence before SDK dispatch", async () => {
	const send = mock(() => Response.json(result()));
	await expect(
		evaluateJev(
			"private-key",
			"界".repeat(32000),
			"fingerprint",
			now,
			transport(send),
		),
	).rejects.toMatchObject({ code: "input_too_large" });
	expect(send).not.toHaveBeenCalled();
});

test("retains strict model, complete distribution, selected maximum, and confidence validation", async () => {
	const wrongModel = { ...result(), model: "jev-other" };
	const missing = result();
	delete missing.answers.readiness.probabilities.ready;
	const wrongSum = result();
	wrongSum.answers.readiness.probabilities.running = 0.8;
	const wrongChoice = result();
	wrongChoice.answers.readiness.choice = "ready";
	const wrongConfidence = result();
	wrongConfidence.answers.readiness.confidence = 2;
	for (const value of [
		wrongModel,
		missing,
		wrongSum,
		wrongChoice,
		wrongConfidence,
	])
		await expect(
			evaluateJev(
				"private-key",
				{},
				"fingerprint",
				now,
				transport(() => Response.json(value)),
			),
		).rejects.toMatchObject({ code: "invalid_response" });
});

test("distinguishes a TypeSafe Cloudflare gateway rejection without leaking its body", async () => {
	await expect(
		evaluateJev(
			"private-key",
			{},
			"fingerprint",
			now,
			transport(() =>
				Response.json(
					{ cloudflare_error: true, error_code: 1010, message: "private-key" },
					{ status: 403 },
				),
			),
		),
	).rejects.toMatchObject({
		code: "gateway_blocked",
		transient: false,
		message: "The TypeSafe gateway blocked the SDK request (Cloudflare 1010).",
	});
});

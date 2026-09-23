import type {
	ContributionFilters,
	DataSource,
	DirectoryData,
} from "@signoff/domain/insights";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { fetchContributionReport } from "@/models/contributionsApi";
import { discover, loadCollectionJob } from "@/models/monitoringApi";
import { useQueryBlock } from "./useQueryBlock";

const active = new Set(["queued", "running"]);
const storageKey = (source: DataSource) => `signoff-insights-jobs:${source}`;
function storedJobs(source: DataSource): string[] {
	try {
		const saved: unknown = JSON.parse(
			sessionStorage.getItem(storageKey(source)) ?? "[]",
		);
		return Array.isArray(saved) && saved.every((id) => typeof id === "string")
			? saved
			: [];
	} catch {
		return [];
	}
}
function saveJobs(source: DataSource, ids: string[]) {
	try {
		sessionStorage.setItem(storageKey(source), JSON.stringify(ids));
	} catch {
		/* Active tasks remain visible in Connector. */
	}
}

export function useContributionReport(
	source: DataSource,
	filters: ContributionFilters | null,
	directory: DirectoryData | null,
) {
	const session = useMemo(() => ({ source, active: true }), [source]);
	const submissions = useRef(new Set<DataSource>());
	const current = useRef(session);
	current.current = session;
	useEffect(() => {
		session.active = true;
		return () => {
			session.active = false;
		};
	}, [session]);
	const [state, setState] = useState(() => ({
		session,
		ids: storedJobs(source),
		submitting: false,
		message: null as string | null,
		error: null as string | null,
	}));
	if (state.session !== session)
		setState({
			session,
			ids: storedJobs(source),
			submitting: submissions.current.has(source),
			message: null,
			error: null,
		});
	const ids = state.session === session ? state.ids : [];
	const encoded = filters?.source === source ? JSON.stringify(filters) : null;
	const currentFilters = useRef(encoded);
	currentFilters.current = encoded;
	const report = useQueryBlock(
		encoded ? `contribution-report:${encoded}` : null,
		(signal) => fetchContributionReport(filters as ContributionFilters, signal),
		ids.length ? 3000 : 0,
	);
	const directoryVersion = useRef({ source, revision: directory?.revision });
	useEffect(() => {
		const previous = directoryVersion.current;
		directoryVersion.current = { source, revision: directory?.revision };
		if (previous.source === source && previous.revision !== directory?.revision)
			void report.reload();
	}, [source, directory?.revision, report.reload]);
	const jobs = useQueryBlock(
		ids.length ? `insights-jobs:${source}:${JSON.stringify(ids)}` : null,
		(signal) =>
			Promise.all(
				ids.map(async (id) => {
					try {
						return await loadCollectionJob(source, id, signal);
					} catch (error) {
						if (!(error instanceof ApiError) || error.status !== 404)
							throw error;
						return {
							id,
							state: "failed" as const,
							error:
								"Discovery task history expired. Calculate again to refresh the report.",
							message: "Task expired",
							children: [],
						};
					}
				}),
			),
		2000,
	);
	useEffect(() => {
		if (!jobs.data || !ids.length) return;
		const expanded = [
			...new Set([...ids, ...jobs.data.flatMap((job) => job.children ?? [])]),
		];
		if (expanded.length !== ids.length) {
			saveJobs(source, expanded);
			setState((previous) => ({ ...previous, ids: expanded }));
			return;
		}
		if (jobs.data.some((job) => active.has(job.state))) return;
		const failed = jobs.data.filter((job) => job.state !== "succeeded");
		saveJobs(source, []);
		setState((previous) => ({
			...previous,
			ids: [],
			message: failed.length
				? "Discovery finished with issues. Available cached results are shown."
				: "Discovery complete. Reports show the updated cache.",
			error: failed.length
				? [previous.error, ...failed.map((job) => job.error ?? job.message)]
						.filter(Boolean)
						.join("; ")
				: previous.error,
		}));
		void report.reload();
	}, [jobs.data, ids, source, report.reload]);
	const calculate = async () => {
		if (
			!filters ||
			filters.source !== source ||
			current.current !== session ||
			currentFilters.current !== encoded ||
			!session.active ||
			!directory ||
			directory.source !== source ||
			submissions.current.has(source) ||
			ids.length
		)
			return;
		submissions.current.add(source);
		setState((previous) => ({
			...previous,
			submitting: true,
			message: null,
			error: null,
		}));
		try {
			const projects = directory.projects.filter(
				(project) =>
					project.enabled &&
					project.source === source &&
					(source === "demo" || project.provider === "ado") &&
					(!filters.projectIds.length ||
						filters.projectIds.includes(project.id)),
			);
			const selected = filters.repositoryKeys.map((key) => {
				const repository = directory.repositories.find(
					(item) => item.key === key,
				);
				if (!repository)
					throw new Error(
						"A selected repository is unavailable. Reload the directory or change your filters.",
					);
				return repository;
			});
			const targets = projects.filter(
				(project) =>
					!selected.length ||
					selected.some((repo) => repo.projectId === project.id),
			);
			if (!targets.length)
				throw new Error(
					"No enabled repositories match this scope. Configure a project or change your filters.",
				);
			const receipts = await Promise.allSettled(
				targets.map((project) =>
					discover(source, {
						projectId: project.id,
						...(selected.length
							? {
									repositoryIds: selected
										.filter((repo) => repo.projectId === project.id)
										.map((repo) => repo.id),
								}
							: {}),
						depth: "deep",
					}),
				),
			);
			const queued = [
				...new Set(
					receipts.flatMap((receipt) =>
						receipt.status === "fulfilled"
							? receipt.value.jobs.map((job) => job.id)
							: [],
					),
				),
			];
			const errors = receipts.flatMap((receipt) =>
				receipt.status === "rejected"
					? [
							receipt.reason instanceof Error
								? receipt.reason.message
								: "Could not start discovery",
						]
					: [],
			);
			saveJobs(source, queued);
			if (current.current.source === source && current.current.active)
				setState({
					session: current.current,
					ids: queued,
					submitting: false,
					message: queued.length ? null : "No discovery tasks were scheduled.",
					error: errors.length ? errors.join("; ") : null,
				});
		} catch (error) {
			if (current.current.source === source && current.current.active)
				setState((previous) => ({
					...previous,
					submitting: false,
					error:
						error instanceof Error
							? error.message
							: "Could not start discovery",
				}));
		} finally {
			submissions.current.delete(source);
		}
	};
	const completed =
		jobs.data?.filter((job) => !active.has(job.state)).length ?? 0;
	return {
		report: report.data,
		loading: report.loading,
		error: state.error ?? jobs.error ?? report.error,
		calculating: state.submitting || ids.length > 0,
		progress: state.submitting
			? "Scheduling discovery by repository…"
			: ids.length
				? `Discovering repositories: ${completed} / ${ids.length} tasks finished. Existing cached results remain available.`
				: state.message,
		calculate,
		reload: report.reload,
	};
}

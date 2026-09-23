import type {
	ContributionFilters,
	ContributionModule,
	ContributionReport,
	ContributionSnapshot,
} from "@signoff/domain/insights";
import { apiFetch } from "@/lib/api";

function assertScope(
	snapshot: ContributionSnapshot,
	module: ContributionModule,
	filters: ContributionFilters,
) {
	if (
		snapshot.module !== module ||
		JSON.stringify(snapshot.filters) !== JSON.stringify(filters)
	) {
		throw new Error("Statistics scope mismatch");
	}
}

export async function fetchContribution(
	module: ContributionModule,
	filters: ContributionFilters,
): Promise<ContributionSnapshot | null> {
	const { snapshot } = await apiFetch<{
		snapshot: ContributionSnapshot | null;
	}>(
		`/api/insights/${module}?filters=${encodeURIComponent(JSON.stringify(filters))}`,
	);
	if (snapshot) assertScope(snapshot, module, filters);
	return snapshot;
}

export async function calculateContribution(
	module: ContributionModule,
	filters: ContributionFilters,
): Promise<ContributionSnapshot> {
	const { snapshot } = await apiFetch<{
		snapshot: ContributionSnapshot | null;
	}>(`/api/insights/${module}`, {
		method: "POST",
		body: JSON.stringify(filters),
	});
	if (!snapshot) throw new Error("Statistics scope mismatch");
	assertScope(snapshot, module, filters);
	return snapshot;
}

export async function fetchContributionReport(
	filters: ContributionFilters,
	signal: AbortSignal,
): Promise<ContributionReport> {
	const { report } = await apiFetch<{ report: ContributionReport }>(
		`/api/insights/report?filters=${encodeURIComponent(JSON.stringify(filters))}`,
		{ signal },
	);
	if (!report || JSON.stringify(report.filters) !== JSON.stringify(filters))
		throw new Error("Statistics scope mismatch");
	return report;
}

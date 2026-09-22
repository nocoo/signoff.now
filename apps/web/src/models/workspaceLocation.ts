import type { DataSource } from "@signoff/domain/monitoring";
import {
	type Project,
	type PullRequest,
	repositoryNameSchema,
	repositoryUrl,
} from "@signoff/domain/workbench";

type ProjectScope = Pick<Project, "provider" | "organization" | "projectKey">;
type Repository = Pick<PullRequest["repository"], "id" | "name">;
type Pull = Pick<PullRequest, "number" | "repository">;
export type WorkspaceLocation = {
	section: "sm" | "prs";
	valid: boolean;
	project: ProjectScope | null;
	repository: string | null;
	number: number | null;
};

export function sourceFromParams(
	params: URLSearchParams,
	fallback: DataSource = "cli",
): DataSource {
	const source = params.get("source");
	return source === "sample" || source === "demo"
		? "demo"
		: source === "live" || source === "cli"
			? "cli"
			: fallback;
}

export function withQuery(path: string, params: URLSearchParams) {
	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

function repositorySegment(project: ProjectScope, repository: Repository) {
	// ADO treats UUID-shaped references as IDs, even when another repo uses one as its name.
	return project.provider === "ado" &&
		/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(repository.name)
		? repository.id
		: repository.name;
}

function scopePath(
	section: "sm" | "prs",
	project: ProjectScope,
	repository?: Repository | null,
) {
	const parts =
		project.provider === "ado"
			? ["ado", project.organization, project.projectKey]
			: ["github", project.projectKey];
	if (repository) parts.push(repositorySegment(project, repository));
	return `/${section}/${parts.map(encodeURIComponent).join("/")}`;
}

function sourceParams(source: DataSource, previous: URLSearchParams) {
	const params = new URLSearchParams(previous);
	if (source === "demo") params.set("source", "sample");
	else params.delete("source");
	return params;
}

export function machineHref(
	project: ProjectScope & { source: DataSource },
	repository?: Repository | null,
	pull?: Pull | null,
	previous = new URLSearchParams(),
) {
	const params = sourceParams(project.source, previous);
	for (const key of ["project", "repo", "trace"]) params.delete(key);
	if (pull)
		params.set(
			"pr",
			repository?.id === pull.repository.id
				? String(pull.number)
				: `${repositorySegment(project, pull.repository)}/${pull.number}`,
		);
	else params.delete("pr");
	return withQuery(scopePath("sm", project, repository), params);
}

export function policyHref(
	project: ProjectScope & { source: DataSource },
	repository?: Repository | null,
) {
	return machineHref(project, repository).replace(
		/^\/sm/,
		"/policy-instructions",
	);
}

export function pullHref(
	project: ProjectScope & { source: DataSource },
	pull: Pull,
	previous = new URLSearchParams(),
) {
	const params = sourceParams(project.source, previous);
	params.delete("pr");
	return withQuery(
		`${scopePath("prs", project, pull.repository)}/${pull.number}`,
		params,
	);
}

function pullNumber(value: string) {
	return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
		? Number(value)
		: null;
}

export function parseWorkspaceLocation(
	pathname: string,
): WorkspaceLocation | null {
	const path = pathname.replace(/\/+$/, "") || "/";
	const raw = path.split("/").slice(1);
	const root = raw[0];
	const section =
		root === "sm" || root === "state-machines"
			? "sm"
			: root === "prs" || path === "/"
				? "prs"
				: null;
	if (!section) return null;
	const base: WorkspaceLocation = {
		section,
		valid: true,
		project: null,
		repository: null,
		number: null,
	};
	if (raw.length === 1) return base;
	const invalid = { ...base, valid: false };
	try {
		const parts = raw.slice(1).map(decodeURIComponent);
		const provider = parts.shift();
		if (provider !== "ado" && provider !== "github") return invalid;
		const organization = provider === "ado" ? parts.shift() : "github.com";
		const projectKey = parts.shift();
		if (
			!organization ||
			!projectKey ||
			![organization, projectKey, ...parts].every(
				(part) =>
					repositoryNameSchema.safeParse(part).success &&
					part !== "." &&
					part !== "..",
			)
		)
			return invalid;
		const repository = parts.shift() ?? null;
		const number = section === "prs" ? pullNumber(parts.shift() ?? "") : null;
		if (parts.length || (section === "prs" && (!repository || !number)))
			return invalid;
		return {
			...base,
			project: { provider, organization, projectKey },
			repository,
			number,
		};
	} catch {
		return invalid;
	}
}

export function matchesProject(scope: ProjectScope, project: ProjectScope) {
	return (
		scope.provider === project.provider &&
		scope.organization.toLowerCase() === project.organization.toLowerCase() &&
		scope.projectKey.toLowerCase() === project.projectKey.toLowerCase()
	);
}

export function traceReference(
	location: WorkspaceLocation | null,
	value: string | null,
) {
	if (!location?.valid || !location.project || !value) return null;
	const parts = value.split("/");
	const repository = parts.length === 1 ? location.repository : parts.shift();
	const number = pullNumber(parts.shift() ?? "");
	if (
		!repository ||
		!number ||
		parts.length ||
		!repositoryNameSchema.safeParse(repository).success
	)
		return null;
	return { repositoryUrl: repositoryUrl(location.project, repository), number };
}

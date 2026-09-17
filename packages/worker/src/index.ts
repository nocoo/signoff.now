import { Hono } from "hono";
import { accessAuth } from "./middleware/access-auth.js";
import { entryControl } from "./middleware/entry-control.js";
import { pipelineAuth } from "./middleware/pipeline-auth.js";
import {
	activityHeatmapRoute,
	activityTimelineRoute,
} from "./routes/activity.js";
import {
	collectorBatchRoute,
	collectorClaimRoute,
	collectorCompleteRoute,
	collectorFailRoute,
	collectorHeartbeatRoute,
	collectorProgressRoute,
} from "./routes/collection.js";
import {
	developersArchiveRoute,
	developersCreateRoute,
	developersListRoute,
	developersPatchRoute,
	developersRestoreRoute,
} from "./routes/developers.js";
import { liveRoute } from "./routes/live.js";
import { meRoute } from "./routes/me.js";
import {
	pipelineBootstrapRoute,
	pipelineIngestRoute,
	pipelineRecomputeCompleteRoute,
} from "./routes/pipeline.js";
import {
	reposArchiveRoute,
	reposCreateRoute,
	reposListRoute,
	reposPatchRoute,
	reposRestoreRoute,
} from "./routes/repos.js";
import { settingsGetRoute, settingsPutRoute } from "./routes/settings.js";
import { statsSummaryRoute } from "./routes/stats.js";
import {
	tagsArchiveRoute,
	tagsCreateRoute,
	tagsListRoute,
	tagsPatchRoute,
	tagsRestoreRoute,
} from "./routes/tags.js";
import {
	teamsArchiveRoute,
	teamsCreateRoute,
	teamsListRoute,
	teamsPatchRoute,
	teamsRestoreRoute,
} from "./routes/teams.js";
import {
	projectsCreateRoute,
	projectsDeleteRoute,
	projectsPatchRoute,
	projectsScanRoute,
	workbenchRoute,
} from "./routes/workbench.js";
import type { AppEnv } from "./types.js";

const app = new Hono<AppEnv>();

app.use("*", entryControl);
app.use("/api/*", accessAuth);
app.use("/api/*", pipelineAuth);

app.get("/", (c) => c.text("signoff ok"));
app.get("/api/live", liveRoute);
app.get("/api/me", meRoute);

app.get("/api/workbench", workbenchRoute);
app.post("/api/projects", projectsCreateRoute);
app.patch("/api/projects/:id", projectsPatchRoute);
app.delete("/api/projects/:id", projectsDeleteRoute);
app.post("/api/projects/:id/scan", projectsScanRoute);
app.post("/api/collector/heartbeat", collectorHeartbeatRoute);
app.post("/api/collector/claim", collectorClaimRoute);
app.post("/api/collector/jobs/:id/progress", collectorProgressRoute);
app.post("/api/collector/jobs/:id/batch", collectorBatchRoute);
app.post("/api/collector/jobs/:id/complete", collectorCompleteRoute);
app.post("/api/collector/jobs/:id/fail", collectorFailRoute);

app.get("/api/settings", settingsGetRoute);
app.put("/api/settings", settingsPutRoute);

app.get("/api/pipeline/bootstrap", pipelineBootstrapRoute);
app.post("/api/pipeline/ingest", pipelineIngestRoute);
app.post("/api/pipeline/recompute/complete", pipelineRecomputeCompleteRoute);

app.get("/api/stats/summary", statsSummaryRoute);

app.get("/api/activity/heatmap", activityHeatmapRoute);
app.get("/api/activity/timeline", activityTimelineRoute);

app.get("/api/developers", developersListRoute);
app.post("/api/developers", developersCreateRoute);
app.patch("/api/developers/:id", developersPatchRoute);
app.post("/api/developers/:id/archive", developersArchiveRoute);
app.post("/api/developers/:id/restore", developersRestoreRoute);

app.get("/api/teams", teamsListRoute);
app.post("/api/teams", teamsCreateRoute);
app.patch("/api/teams/:id", teamsPatchRoute);
app.post("/api/teams/:id/archive", teamsArchiveRoute);
app.post("/api/teams/:id/restore", teamsRestoreRoute);

app.get("/api/tags", tagsListRoute);
app.post("/api/tags", tagsCreateRoute);
app.patch("/api/tags/:id", tagsPatchRoute);
app.post("/api/tags/:id/archive", tagsArchiveRoute);
app.post("/api/tags/:id/restore", tagsRestoreRoute);

app.get("/api/repos", reposListRoute);
app.post("/api/repos", reposCreateRoute);
app.patch("/api/repos/:id", reposPatchRoute);
app.post("/api/repos/:id/archive", reposArchiveRoute);
app.post("/api/repos/:id/restore", reposRestoreRoute);

export default app;

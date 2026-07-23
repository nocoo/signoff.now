#!/usr/bin/env bash
# 06 local E2E gate: migrate → seed → ingest fixture → heatmap non-empty.
# Requires: wrangler, bun; Worker not required if using wrangler d1 execute only for seed —
# ingest needs a running local Worker (dev:worker on 37042).
# Idempotent: cleans prior e2e rows before re-seed (FK-safe order).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${SIGNOFF_PORT:-37042}"
API="http://127.0.0.1:${PORT}"
DEV_ID="01K0E2E06DEV00000000000000"
REPO_ID="01K0E2E06REPO000000000000"
RUN_ID="01JAY7B4HXTMRP0VQZ0FKZH5E2"
REPO_GUID="11111111-1111-4111-8111-111111111111"
PROJ_GUID="22222222-2222-4222-8222-222222222222"

echo "==> migrate local"
bunx wrangler d1 migrations apply signoff-db --local

echo "==> clean prior e2e rows (idempotent re-run)"
bunx wrangler d1 execute signoff-db --local --command \
  "DELETE FROM ingest_chunks WHERE run_id = '${RUN_ID}';
   DELETE FROM ingest_runs WHERE id = '${RUN_ID}';
   DELETE FROM scores WHERE developer_id = '${DEV_ID}';
   DELETE FROM activities WHERE developer_id = '${DEV_ID}' OR repo_id = '${REPO_ID}';
   DELETE FROM repos WHERE id = '${REPO_ID}';
   DELETE FROM developers WHERE id = '${DEV_ID}';"

echo "==> seed developer + repo"
bunx wrangler d1 execute signoff-db --local --command \
  "INSERT INTO developers (id,name,alias) VALUES ('${DEV_ID}','E2E Dev','e2e');
   INSERT INTO repos (id,provider,org,project,name,external_id,project_external_id,enabled)
   VALUES ('${REPO_ID}','ado','e2e-org','E2E Project','e2e-repo','${REPO_GUID}','${PROJ_GUID}',1);"

mkdir -p .data
FIXTURE=".data/e2e-06-fixture.json"
# Asia/Shanghai day 2026-07-23 00:30 → day_key 2026-07-23
OCCURRED=1784737800
cat >"$FIXTURE" <<EOF
{
  "pipelineConfigVersion": 1,
  "runId": "${RUN_ID}",
  "chunkIndex": 0,
  "isFinalChunk": true,
  "runMeta": {
    "startedAt": 1784737800,
    "source": "fixture",
    "windowFrom": "2026-07-01",
    "windowTo": "2026-07-23",
    "mode": "incremental"
  },
  "activities": [{
    "type": "pr.merged",
    "occurredAt": ${OCCURRED},
    "provider": "ado",
    "org": "e2e-org",
    "project": "E2E Project",
    "repoId": "${REPO_ID}",
    "developerId": "${DEV_ID}",
    "matchedUniqueName": "e2e@example.com",
    "sourceIds": { "prRepoGuid": "${REPO_GUID}", "prId": 7001 },
    "meta": { "title": "e2e" }
  }],
  "unmatchedIdentities": []
}
EOF

echo "==> check worker ${API}"
if ! curl -fsS "${API}/api/live" >/dev/null; then
  echo "Worker not reachable at ${API}. Start: bun run dev:worker" >&2
  exit 1
fi

echo "==> ensure bootstrap cache (version precheck)"
SIGNOFF_API_BASE="${API}" bun run signoff -- settings pull

echo "==> ingest fixture"
SIGNOFF_API_BASE="${API}" bun run signoff -- ingest fixture "$FIXTURE"

echo "==> heatmap"
HEAT=$(curl -fsS "${API}/api/activity/heatmap?devs=${DEV_ID}&from=2026-07-23&to=2026-07-23")
echo "$HEAT" | grep -q '"total":10' || {
  echo "heatmap missing score: $HEAT" >&2
  exit 1
}

echo "==> timeline (day_key window, TZ boundary)"
TL=$(curl -fsS "${API}/api/activity/timeline?dev=${DEV_ID}&from=2026-07-23&to=2026-07-23")
echo "$TL" | grep -q 'pr.merged' || {
  echo "timeline missing activity: $TL" >&2
  exit 1
}

echo "OK e2e-06-local"

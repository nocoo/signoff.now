CREATE INDEX pull_requests_author_observation
ON pull_requests(project_id, json_extract(snapshot, '$.author.id'), json_extract(snapshot, '$.observedAt') DESC, id);

CREATE INDEX pull_requests_repository_observation
ON pull_requests(project_id, repository_id, json_extract(snapshot, '$.observedAt') DESC, id);

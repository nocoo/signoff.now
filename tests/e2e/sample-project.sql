-- Only the disposable E2E database receives this uncollected Sample project.
INSERT INTO projects(id,provider,name,organization,project_key,repositories_json,owner,source,created_at,updated_at)
VALUES('e2e-sample','github','Sample GitHub','github.com','sample-owner','[]','Sample team','demo',1789646400,1789646400);

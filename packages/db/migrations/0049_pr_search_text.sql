ALTER TABLE pull_requests ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

UPDATE pull_requests SET search_text = lower(
  COALESCE(json_extract(snapshot,'$.title'),'')||' #'||external_id||' '||
  COALESCE(json_extract(snapshot,'$.description'),'')||' '||
  COALESCE(json_extract(snapshot,'$.sourceBranch'),'')||' '||
  COALESCE(json_extract(snapshot,'$.targetBranch'),'')||' '||
  COALESCE(json_extract(snapshot,'$.author.name'),'')||' '||
  COALESCE(json_extract(snapshot,'$.author.handle'),'')||' '||
  COALESCE(json_extract(snapshot,'$.author.id'),'')||' '||
  COALESCE(json_extract(snapshot,'$.repository.name'),'')||' '||
  COALESCE(json_extract(snapshot,'$.headSha'),'')||' '||
  COALESCE(json_extract(snapshot,'$.targetSha'),'')||' '||
  COALESCE(json_extract(snapshot,'$.evidence.mergeSha'),'')||' '||
  COALESCE((SELECT group_concat(value,' ') FROM json_each(CASE WHEN json_type(snapshot,'$.labels')='array' THEN json_extract(snapshot,'$.labels') ELSE '[]' END)),'')||' '||
  COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.handle'),''),' ') FROM json_each(CASE WHEN json_type(snapshot,'$.reviewers')='array' THEN json_extract(snapshot,'$.reviewers') ELSE '[]' END)),'')||' '||
  COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.detail'),'')||' '||COALESCE(json_extract(value,'$.owner'),''),' ') FROM json_each(CASE WHEN json_type(snapshot,'$.policies')='array' THEN json_extract(snapshot,'$.policies') ELSE '[]' END)),'')||' '||
  COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.number'),''),' ') FROM json_each(CASE WHEN json_type(snapshot,'$.builds')='array' THEN json_extract(snapshot,'$.builds') ELSE '[]' END)),'')||' '||
  COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.actor'),'')||' '||COALESCE(json_extract(value,'$.title'),'')||' '||COALESCE(json_extract(value,'$.detail'),''),' ') FROM json_each(CASE WHEN json_type(snapshot,'$.activity')='array' THEN json_extract(snapshot,'$.activity') ELSE '[]' END)),'')
);

CREATE TRIGGER pr_search_text_insert AFTER INSERT ON pull_requests BEGIN
  UPDATE pull_requests SET search_text = lower(
    COALESCE(json_extract(NEW.snapshot,'$.title'),'')||' #'||NEW.external_id||' '||
    COALESCE(json_extract(NEW.snapshot,'$.description'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.sourceBranch'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.targetBranch'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.author.name'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.author.handle'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.author.id'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.repository.name'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.headSha'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.targetSha'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.evidence.mergeSha'),'')||' '||
    COALESCE((SELECT group_concat(value,' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.labels')='array' THEN json_extract(NEW.snapshot,'$.labels') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.handle'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.reviewers')='array' THEN json_extract(NEW.snapshot,'$.reviewers') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.detail'),'')||' '||COALESCE(json_extract(value,'$.owner'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.policies')='array' THEN json_extract(NEW.snapshot,'$.policies') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.number'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.builds')='array' THEN json_extract(NEW.snapshot,'$.builds') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.actor'),'')||' '||COALESCE(json_extract(value,'$.title'),'')||' '||COALESCE(json_extract(value,'$.detail'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.activity')='array' THEN json_extract(NEW.snapshot,'$.activity') ELSE '[]' END)),'')
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER pr_search_text_update AFTER UPDATE OF snapshot, external_id ON pull_requests
WHEN OLD.snapshot <> NEW.snapshot OR OLD.external_id <> NEW.external_id BEGIN
  UPDATE pull_requests SET search_text = lower(
    COALESCE(json_extract(NEW.snapshot,'$.title'),'')||' #'||NEW.external_id||' '||
    COALESCE(json_extract(NEW.snapshot,'$.description'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.sourceBranch'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.targetBranch'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.author.name'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.author.handle'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.author.id'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.repository.name'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.headSha'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.targetSha'),'')||' '||
    COALESCE(json_extract(NEW.snapshot,'$.evidence.mergeSha'),'')||' '||
    COALESCE((SELECT group_concat(value,' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.labels')='array' THEN json_extract(NEW.snapshot,'$.labels') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.handle'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.reviewers')='array' THEN json_extract(NEW.snapshot,'$.reviewers') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.detail'),'')||' '||COALESCE(json_extract(value,'$.owner'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.policies')='array' THEN json_extract(NEW.snapshot,'$.policies') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.name'),'')||' '||COALESCE(json_extract(value,'$.number'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.builds')='array' THEN json_extract(NEW.snapshot,'$.builds') ELSE '[]' END)),'')||' '||
    COALESCE((SELECT group_concat(COALESCE(json_extract(value,'$.actor'),'')||' '||COALESCE(json_extract(value,'$.title'),'')||' '||COALESCE(json_extract(value,'$.detail'),''),' ') FROM json_each(CASE WHEN json_type(NEW.snapshot,'$.activity')='array' THEN json_extract(NEW.snapshot,'$.activity') ELSE '[]' END)),'')
  ) WHERE id = NEW.id;
END;

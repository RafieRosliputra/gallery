-- 006_album_rules.sql — album folders become include/exclude rules.
-- Forward-only: never edit after it has been applied; add 007_*.sql instead.
--
-- Every album_folder row is a rule on a folder (and, when recursive, its
-- subtree). For each folder the most specific rule wins: the rule on the folder
-- itself, else the rule on its nearest ancestor. A folder is in the album when
-- that winning rule has included = true. Existing rows keep included = true, so
-- every album covers exactly what it covered before.
ALTER TABLE album_folder ADD COLUMN included boolean NOT NULL DEFAULT true;

-- Scope for an ad-hoc rule set (the admin editor previews unsaved rules).
CREATE FUNCTION folder_scope(rule_ids bigint[], rule_included boolean[], rule_recursive boolean[])
RETURNS TABLE (fid bigint)
LANGUAGE sql STABLE AS $$
  WITH rules AS (
    SELECT r.id, r.path, u.inc, u.rec
    FROM unnest(rule_ids, rule_included, rule_recursive) AS u(rid, inc, rec)
    JOIN folder r ON r.id = u.rid
  )
  SELECT f.id
  FROM folder f
  JOIN LATERAL (
    SELECT x.inc
    FROM rules x
    WHERE x.id = f.id
       OR (x.rec AND (x.path = '.' OR starts_with(f.path, x.path || '/')))
    ORDER BY CASE WHEN x.id = f.id THEN 2147483647
                  WHEN x.path = '.' THEN 0
                  ELSE length(x.path) + 1 END DESC
    LIMIT 1
  ) winner ON true
  WHERE winner.inc
$$;

-- Scope of a saved album.
CREATE FUNCTION album_scope(p_album bigint)
RETURNS TABLE (fid bigint)
LANGUAGE sql STABLE AS $$
  SELECT s.fid
  FROM folder_scope(
    ARRAY(SELECT af.folder_id FROM album_folder af WHERE af.album_id = p_album ORDER BY af.folder_id),
    ARRAY(SELECT af.included FROM album_folder af WHERE af.album_id = p_album ORDER BY af.folder_id),
    ARRAY(SELECT af.recursive FROM album_folder af WHERE af.album_id = p_album ORDER BY af.folder_id)
  ) s
$$;

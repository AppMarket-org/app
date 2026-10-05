-- #67 (G1): the marketplace graph. Edges of each repo's published version: npm dependencies
-- (declared range) and Cloudflare bindings (type). Parent edges are repos.forked_from (fork /
-- "Use this template") and repos.session_of. graph_commit records which version they describe.
CREATE TABLE graph_edges (
  repo_id TEXT NOT NULL REFERENCES repos(id),
  kind TEXT NOT NULL, -- dependency | dev-dependency | binding
  target TEXT NOT NULL, -- package name, or binding type (d1, kv, r2, durable-object, ...)
  detail TEXT, -- declared version range, or binding name
  PRIMARY KEY (repo_id, kind, target, detail)
);
CREATE INDEX graph_edges_target ON graph_edges(kind, target);
ALTER TABLE repos ADD COLUMN graph_commit TEXT;
CREATE INDEX repos_forked_from ON repos(forked_from);

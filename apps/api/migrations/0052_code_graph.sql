-- #240: the code graph of each repo's default branch head (symbols and file imports), for agents:
-- where things are defined, who imports a file, and lease conflict hints on the board (#236).
CREATE TABLE code_index (
  repo_id TEXT PRIMARY KEY REFERENCES repos(id),
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  files INTEGER NOT NULL,
  -- 0 when the repo was larger than the indexing limits (the graph covers part of it).
  complete INTEGER NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE code_symbols (
  repo_id TEXT NOT NULL REFERENCES repos(id),
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  exported INTEGER NOT NULL,
  PRIMARY KEY (repo_id, path, name, line)
);
CREATE INDEX code_symbols_name ON code_symbols(repo_id, name);
CREATE TABLE code_imports (
  repo_id TEXT NOT NULL REFERENCES repos(id),
  path TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY (repo_id, path, target)
);
CREATE INDEX code_imports_target ON code_imports(repo_id, target);
CREATE TABLE code_files (
  repo_id TEXT NOT NULL REFERENCES repos(id),
  path TEXT NOT NULL,
  PRIMARY KEY (repo_id, path)
);

-- Runtimes are detected from the code (on import, on pushes while a draft, on submit) instead of
-- picked by hand. Null until there is code to read.
ALTER TABLE repos ADD COLUMN runtime_detected_at TEXT;

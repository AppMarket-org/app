-- PRD D2/D3/G4: template check results for the submitted version, and the deploy manifest of the
-- published version (JSON).
ALTER TABLE listings ADD COLUMN submitted_checks TEXT;
ALTER TABLE listings ADD COLUMN published_manifest TEXT;

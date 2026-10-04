-- #137: the checkpoint's prompts as plain text, for catalog search. Searched only when the
-- checkpoint is not private.
ALTER TABLE checkpoints ADD COLUMN prompt_text TEXT NOT NULL DEFAULT '';
UPDATE checkpoints SET prompt_text = COALESCE((SELECT group_concat(json_extract(value, '$.text'), ' ') FROM json_each(record, '$.prompts')), '');

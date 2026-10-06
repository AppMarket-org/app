-- #298: issue emails (assigned to you, comments, closed), on by default like pull requests.
ALTER TABLE email_preferences ADD COLUMN issues INTEGER NOT NULL DEFAULT 1;

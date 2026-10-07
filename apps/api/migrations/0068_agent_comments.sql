-- Comments an agent posts from its agent session name the agent (and the person it works for).
ALTER TABLE issue_comments ADD COLUMN agent_session_id TEXT REFERENCES agent_sessions(id);

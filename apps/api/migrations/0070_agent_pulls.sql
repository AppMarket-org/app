-- A pull request the Agents board opens for an agent's finished task names that agent.
ALTER TABLE pull_requests ADD COLUMN agent_session_id TEXT REFERENCES agent_sessions(id);

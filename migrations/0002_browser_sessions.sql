-- Opaque browser tokens are stored only as SHA-256 hashes. No credentials or
-- message content belong in this table. Logout revokes the matching session.
CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX browser_sessions_expiry_idx ON browser_sessions(expires_at);

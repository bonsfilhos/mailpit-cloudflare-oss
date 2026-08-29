PRAGMA foreign_keys = ON;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  from_json TEXT NOT NULL DEFAULT 'null',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  reply_to_json TEXT NOT NULL DEFAULT '[]',
  return_path TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  inline_count INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  raw_key TEXT NOT NULL,
  detail_key TEXT NOT NULL,
  from_search TEXT NOT NULL DEFAULT '',
  to_search TEXT NOT NULL DEFAULT '',
  cc_search TEXT NOT NULL DEFAULT '',
  bcc_search TEXT NOT NULL DEFAULT '',
  reply_to_search TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX messages_created_at_idx ON messages(created_at DESC);
CREATE INDEX messages_is_read_idx ON messages(is_read, created_at DESC);
CREATE INDEX messages_message_id_idx ON messages(message_id);

CREATE TABLE message_tags (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (message_id, tag)
);

CREATE INDEX message_tags_tag_idx ON message_tags(tag, message_id);

CREATE TABLE runtime_stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT INTO runtime_stats (key, value) VALUES
  ('accepted', 0),
  ('accepted_bytes', 0),
  ('rejected', 0),
  ('deleted', 0);

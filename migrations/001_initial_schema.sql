-- My Library managed PostgreSQL schema. User content is stored in separate
-- owner-scoped JSONB records; uploaded file bytes live only in private object
-- storage. Session tokens are stored as SHA-256 hashes, never bearer tokens.

BEGIN;

CREATE TABLE library_records (
  collection TEXT NOT NULL CHECK (collection IN (
    'accounts', 'items', 'experiences', 'stories', 'mockHistories'
  )),
  record_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, record_id)
);

CREATE UNIQUE INDEX library_records_account_email_idx
  ON library_records (LOWER(data->>'email'))
  WHERE collection = 'accounts';
CREATE INDEX library_records_owner_collection_idx
  ON library_records (owner_id, collection, created_at DESC);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX sessions_user_idx ON sessions (user_id);

COMMIT;

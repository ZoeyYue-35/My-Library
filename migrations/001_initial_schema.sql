-- My Library cloud database blueprint (PostgreSQL).
-- This is NOT executed by the current local JSON runtime. A migration is a
-- versioned, reviewable description of how an empty cloud database is built
-- or changed. It contains schema only, never real accounts or uploaded data.

BEGIN;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL DEFAULT 'gpt-5-mini',
  encrypted_key TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE library_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  object_key TEXT,
  extracted_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE experience_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  source_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'star',
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  question TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mock_histories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  job_description TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX library_items_user_created_idx ON library_items (user_id, created_at DESC);
CREATE INDEX stories_user_confirmed_idx ON stories (user_id, confirmed_at DESC);
CREATE INDEX mock_histories_user_saved_idx ON mock_histories (user_id, saved_at DESC);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

COMMIT;

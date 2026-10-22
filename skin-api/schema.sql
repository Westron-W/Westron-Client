PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  email TEXT,
  email_normalized TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL DEFAULT '',
  password_algorithm TEXT NOT NULL DEFAULT 'argon2id' CHECK (password_algorithm IN ('argon2id', 'scrypt')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_idx
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS access_tokens_expiry_idx ON access_tokens(expires_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  replaced_by_hash TEXT
);

CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON refresh_tokens(session_id);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL CHECK (model IN ('classic', 'slim')),
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 2;

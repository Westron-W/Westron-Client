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
  minecraft_username TEXT,
  minecraft_username_normalized TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_idx
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_minecraft_username_normalized_idx
  ON users(minecraft_username_normalized) WHERE minecraft_username_normalized IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS capes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS elytras (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (requester_user_id != recipient_user_id),
  UNIQUE (requester_user_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS friend_requests_recipient_status_idx
  ON friend_requests(recipient_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS friend_requests_requester_status_idx
  ON friend_requests(requester_user_id, status, created_at);

CREATE TABLE IF NOT EXISTS friendships (
  user_low_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK (user_low_id < user_high_id),
  PRIMARY KEY (user_low_id, user_high_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_game INTEGER NOT NULL CHECK (in_game IN (0, 1)),
  server_name TEXT,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ephemeral_messages (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  photo_url TEXT,
  sender_photo_viewed_at TEXT,
  recipient_photo_viewed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (sender_user_id != recipient_user_id)
);

CREATE INDEX IF NOT EXISTS ephemeral_messages_recipient_expiry_idx
  ON ephemeral_messages(recipient_user_id, expires_at, created_at);

CREATE TABLE IF NOT EXISTS call_signals (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT,
  call_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'candidate', 'hangup', 'reject')),
  sdp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (sender_user_id != recipient_user_id)
);

CREATE INDEX IF NOT EXISTS call_signals_recipient_expiry_idx
  ON call_signals(recipient_user_id, expires_at, created_at);

CREATE TABLE IF NOT EXISTS friend_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friend_group_members (
  group_id TEXT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS friend_group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'photo')),
  photo_file_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS friend_group_messages_group_created_idx
  ON friend_group_messages(group_id, created_at, id);
CREATE INDEX IF NOT EXISTS ephemeral_messages_photo_expiry_idx
  ON ephemeral_messages(expires_at) WHERE kind = 'photo';

PRAGMA user_version = 15;

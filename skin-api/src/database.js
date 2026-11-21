import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function migrateDatabase(database) {
  database.pragma('foreign_keys = ON');
  const version = database.pragma('user_version', { simple: true });
  const hasUsersTable = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).get());

  if (!hasUsersTable) {
    database.exec(await readFile(path.join(ROOT, 'schema.sql'), 'utf8'));
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS capes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (version < 2) {
    const userColumns = new Set(database.pragma('table_info(users)').map((column) => column.name));
    const sessionColumns = new Set(database.pragma('table_info(sessions)').map((column) => column.name));
    const legacySessions = sessionColumns.has('token_hash') && !sessionColumns.has('id');
    const legacySessionRows = legacySessions
      ? database.prepare('SELECT token_hash, user_id, expires_at, created_at FROM sessions').all()
      : [];

    database.exec('BEGIN IMMEDIATE');
    try {
      if (!userColumns.has('email')) database.exec('ALTER TABLE users ADD COLUMN email TEXT');
      if (!userColumns.has('email_normalized')) database.exec('ALTER TABLE users ADD COLUMN email_normalized TEXT');
      if (!userColumns.has('email_verified')) {
        database.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
      }
      if (!userColumns.has('password_algorithm')) {
        database.exec("ALTER TABLE users ADD COLUMN password_algorithm TEXT NOT NULL DEFAULT 'scrypt'");
      }
      if (!userColumns.has('minecraft_username')) database.exec('ALTER TABLE users ADD COLUMN minecraft_username TEXT');
      if (!userColumns.has('minecraft_username_normalized')) {
        database.exec('ALTER TABLE users ADD COLUMN minecraft_username_normalized TEXT');
      }
      if (legacySessions) database.exec('ALTER TABLE sessions RENAME TO sessions_legacy');
      database.exec(await readFile(path.join(ROOT, 'schema.sql'), 'utf8'));

      const insertSession = database.prepare(`
        INSERT INTO sessions (id, user_id, created_at, refresh_expires_at)
        VALUES (?, ?, ?, ?)
      `);
      const insertAccessToken = database.prepare(`
        INSERT INTO access_tokens (token_hash, session_id, expires_at)
        VALUES (?, ?, ?)
      `);
      for (const legacy of legacySessionRows) {
        const sessionId = randomUUID();
        insertSession.run(sessionId, legacy.user_id, legacy.created_at, legacy.expires_at);
        insertAccessToken.run(legacy.token_hash, sessionId, legacy.expires_at);
      }
      if (legacySessions) database.exec('DROP TABLE sessions_legacy');
      database.pragma('user_version = 2');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (version < 3) database.pragma('user_version = 3');

  const userColumns = new Set(database.pragma('table_info(users)').map((column) => column.name));
  database.exec('BEGIN IMMEDIATE');
  try {
    if (!userColumns.has('minecraft_username')) database.exec('ALTER TABLE users ADD COLUMN minecraft_username TEXT');
    if (!userColumns.has('minecraft_username_normalized')) {
      database.exec('ALTER TABLE users ADD COLUMN minecraft_username_normalized TEXT');
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_minecraft_username_normalized_idx
      ON users(minecraft_username_normalized) WHERE minecraft_username_normalized IS NOT NULL;
    `);
    if (version < 4) database.pragma('user_version = 4');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  if (version < 5) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
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
          last_seen_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ephemeral_messages (
          id TEXT PRIMARY KEY,
          sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
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
          call_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'hangup', 'reject')),
          sdp TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          CHECK (sender_user_id != recipient_user_id)
        );
        CREATE INDEX IF NOT EXISTS call_signals_recipient_expiry_idx
          ON call_signals(recipient_user_id, expires_at, created_at);
      `);
      database.pragma('user_version = 5');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

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

  const presenceColumns = new Set(database.pragma('table_info(presence)').map((column) => column.name));
  const messageColumns = new Set(database.pragma('table_info(ephemeral_messages)').map((column) => column.name));
  if (!presenceColumns.has('server_name') || !messageColumns.has('kind')
    || !messageColumns.has('photo_url') || database.pragma('user_version', { simple: true }) < 6) {
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!presenceColumns.has('server_name')) database.exec('ALTER TABLE presence ADD COLUMN server_name TEXT');
      if (!messageColumns.has('kind')) database.exec("ALTER TABLE ephemeral_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
      if (!messageColumns.has('photo_url')) database.exec('ALTER TABLE ephemeral_messages ADD COLUMN photo_url TEXT');
      database.pragma('user_version = 6');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (database.pragma('user_version', { simple: true }) < 7) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
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
      `);
      database.pragma('user_version = 7');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

  }

  if (database.pragma('user_version', { simple: true }) < 8) {
    const messageColumns = new Set(database.pragma('table_info(ephemeral_messages)').map((column) => column.name));
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!messageColumns.has('sender_photo_viewed_at')) {
        database.exec('ALTER TABLE ephemeral_messages ADD COLUMN sender_photo_viewed_at TEXT');
      }
      if (!messageColumns.has('recipient_photo_viewed_at')) {
        database.exec('ALTER TABLE ephemeral_messages ADD COLUMN recipient_photo_viewed_at TEXT');
      }
      database.pragma('user_version = 8');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (version < 9) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
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
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS friend_group_messages_group_created_idx
          ON friend_group_messages(group_id, created_at, id);
      `);
      database.pragma('user_version = 9');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (version < 10) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS call_signals (
          id TEXT PRIMARY KEY,
          sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'candidate', 'hangup', 'reject')),
          sdp TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          CHECK (sender_user_id != recipient_user_id)
        );
        DROP INDEX IF EXISTS call_signals_recipient_expiry_idx;
        ALTER TABLE call_signals RENAME TO call_signals_legacy;
        CREATE TABLE call_signals (
          id TEXT PRIMARY KEY,
          sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'candidate', 'hangup', 'reject')),
          sdp TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          CHECK (sender_user_id != recipient_user_id)
        );
        INSERT INTO call_signals
          (id, sender_user_id, recipient_user_id, call_id, type, sdp, created_at, expires_at)
        SELECT id, sender_user_id, recipient_user_id, call_id, type, sdp, created_at, expires_at
        FROM call_signals_legacy;
        DROP TABLE call_signals_legacy;
        CREATE INDEX call_signals_recipient_expiry_idx
          ON call_signals(recipient_user_id, expires_at, created_at);
      `);
      database.pragma('user_version = 10');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (version < 11) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const groupColumns = new Set(database.pragma('table_info(friend_groups)').map((column) => column.name));
      if (!groupColumns.has('created_by_user_id')) {
        database.exec(`
          ALTER TABLE friend_groups
          ADD COLUMN created_by_user_id TEXT REFERENCES users(id) ON DELETE CASCADE
        `);
        database.exec('UPDATE friend_groups SET created_by_user_id = owner_user_id');
      }
      database.pragma('user_version = 11');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (version < 12) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const messageColumns = new Set(database.pragma('table_info(friend_group_messages)').map((column) => column.name));
      if (!messageColumns.has('kind')) {
        database.exec("ALTER TABLE friend_group_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
      }
      if (!messageColumns.has('photo_file_name')) {
        database.exec('ALTER TABLE friend_group_messages ADD COLUMN photo_file_name TEXT');
      }
      database.pragma('user_version = 12');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (database.pragma('user_version', { simple: true }) < 13) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const messageColumns = new Set(database.pragma('table_info(ephemeral_messages)').map((column) => column.name));
      if (messageColumns.has('kind') && messageColumns.has('expires_at')) {
        database.exec(`
          CREATE INDEX IF NOT EXISTS ephemeral_messages_photo_expiry_idx
            ON ephemeral_messages(expires_at) WHERE kind = 'photo';
        `);
      }
      if (messageColumns.has('kind') && messageColumns.has('created_at') && messageColumns.has('expires_at')) {
        database.exec(`
          UPDATE ephemeral_messages
          SET expires_at = MIN(
            expires_at,
            CAST(strftime('%s', created_at, '+30 days') AS INTEGER) * 1000
          )
          WHERE kind = 'photo'
            AND strftime('%s', created_at, '+30 days') IS NOT NULL;
        `);
      }
      database.pragma('user_version = 13');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (database.pragma('user_version', { simple: true }) < 14) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const hasCallSignalsTable = Boolean(database.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'call_signals'",
      ).get());
      if (hasCallSignalsTable) {
        const signalColumns = new Set(database.pragma('table_info(call_signals)').map((column) => column.name));
        if (!signalColumns.has('group_id')) database.exec('ALTER TABLE call_signals ADD COLUMN group_id TEXT');
      }
      database.pragma('user_version = 14');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  if (database.pragma('user_version', { simple: true }) < 15) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS elytras (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          storage_key TEXT NOT NULL UNIQUE,
          sha256 TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      database.pragma('user_version = 15');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

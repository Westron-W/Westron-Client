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
  if (version >= 2) return;

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

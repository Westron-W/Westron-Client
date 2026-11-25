import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import { buildApp } from '../src/app.js';
import { migrateDatabase } from '../src/database.js';
import { hashToken } from '../src/security.js';

let app;
let dataDir;
let mailTokens;
const fakeMailer = {
  async sendVerification(_email, _username, token) {
    mailTokens.verification.push(token);
  },
  async sendPasswordReset(_email, _username, token) {
    mailTokens.reset.push(token);
  },
};

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'westron-skin-api-'));
  mailTokens = { verification: [], reset: [] };
  app = await buildApp({
    dataDir,
    logger: false,
    mailer: fakeMailer,
    env: {
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: 'https://westronskin.example.test',
      UPDATE_PUBLISHER_EMAIL: 'regular@example.test',
      RATE_LIMIT_MAX: '1000',
      AUTH_RATE_LIMIT_MAX: '1000',
    },
  });
});

test('allows enough time for large release uploads to arrive through a slow connection', () => {
  assert.equal(app.server.requestTimeout, 90 * 60 * 1000);
  assert.equal(app.skinDatabase.pragma('user_version', { simple: true }), 15);
});

test('temporarily locks failed logins per account and client address', async () => {
  const email = 'LockoutPlayer@example.test';
  await createAccount('LockoutPlayer', email);
  const login = (remoteAddress, password) => app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress,
    payload: { email, password },
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await login('192.0.2.10', 'incorrect password')).statusCode, 401);
  }
  const locked = await login('192.0.2.10', 'incorrect password');
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().error.code, 'login_temporarily_locked');
  assert.match(locked.json().error.message, /Çok Fazla Yanlış Giriş Yapıldı/);

  assert.equal((await login('192.0.2.11', 'correct horse battery staple')).statusCode, 200);

  const realNow = Date.now;
  const lockStartedAt = realNow();
  Date.now = () => lockStartedAt + 5 * 60 * 1000 + 1;
  try {
    assert.equal((await login('192.0.2.10', 'correct horse battery staple')).statusCode, 200);
  } finally {
    Date.now = realNow;
  }
});

test('blocks a seventh message within ten seconds and resumes after five seconds', async () => {
  const sender = await createAccount('CooldownSender');
  const receiver = await createAccount('CooldownFriend');
  const senderHeaders = bearer(sender.accessToken);
  const receiverHeaders = bearer(receiver.accessToken);
  const friendRequest = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/requests',
    headers: senderHeaders,
    payload: { username: 'CooldownFriend' },
  });
  assert.equal(friendRequest.statusCode, 201);
  const requestId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: receiverHeaders,
  })).json().incomingRequests[0].requestId;
  assert.equal((await app.inject({
    method: 'POST',
    url: `/api/v1/friends/requests/${requestId}/respond`,
    headers: receiverHeaders,
    payload: { accept: true },
  })).statusCode, 200);
  const recipientUserId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: senderHeaders,
  })).json().friends[0].userId;
  const sendMessage = () => app.inject({
    method: 'POST',
    url: '/api/v1/friends/messages',
    headers: senderHeaders,
    payload: { recipientUserId, body: 'Hello there' },
  });

  const realNow = Date.now;
  const currentTime = realNow();
  Date.now = () => currentTime;
  try {
    for (let messageNumber = 0; messageNumber < 6; messageNumber += 1) {
      assert.equal((await sendMessage()).statusCode, 201);
    }
    const throttled = await sendMessage();
    assert.equal(throttled.statusCode, 429);
    assert.equal(throttled.json().error.code, 'message_cooldown');
    assert.equal(throttled.json().error.message, 'Çok Hızlı Mesaj Gönderiyorsun! Lütfen 5 Saniye Bekle.');

    Date.now = () => currentTime + 4_999;
    assert.equal((await sendMessage()).statusCode, 429);
    Date.now = () => currentTime + 5_001;
    assert.equal((await sendMessage()).statusCode, 201);
  } finally {
    Date.now = realNow;
  }
});

test('migrates version 14 databases by adding the separate elytra texture table', async () => {
  const database = new Database(':memory:');
  try {
    database.exec(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
    database.exec('DROP TABLE elytras; PRAGMA user_version = 14;');
    await migrateDatabase(database);
    assert.equal(database.pragma('user_version', { simple: true }), 15);
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'elytras'").get());
  } finally {
    database.close();
  }
});

test('migrates existing groups to retain their original creator', async () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        minecraft_username TEXT,
        minecraft_username_normalized TEXT
      );
      CREATE TABLE presence (
        user_id TEXT PRIMARY KEY,
        in_game INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        server_name TEXT
      );
      CREATE TABLE ephemeral_messages (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'text',
        photo_url TEXT,
        sender_photo_viewed_at TEXT,
        recipient_photo_viewed_at TEXT
      );
      CREATE TABLE friend_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE friend_group_messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
        sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users (id) VALUES ('group-creator');
      INSERT INTO friend_groups (id, name, owner_user_id, created_at)
      VALUES ('existing-group', 'Existing group', 'group-creator', '2026-01-01T00:00:00.000Z');
      PRAGMA user_version = 10;
    `);

    await migrateDatabase(database);

    assert.equal(database.pragma('user_version', { simple: true }), 15);
    assert.equal(database.prepare(
      'SELECT created_by_user_id FROM friend_groups WHERE id = ?',
    ).get('existing-group').created_by_user_id, 'group-creator');
    const messageColumns = new Set(database.pragma('table_info(friend_group_messages)').map((column) => column.name));
    assert.equal(messageColumns.has('kind'), true);
    assert.equal(messageColumns.has('photo_file_name'), true);
  } finally {
    database.close();
  }
});

test('stores reusable direct photos for sender and recipient', async () => {
  const alice = await createAccount('PhotoSender');
  const bob = await createAccount('PhotoReceiver');
  const aliceHeaders = bearer(alice.accessToken);
  const bobHeaders = bearer(bob.accessToken);
  await app.inject({
    method: 'POST',
    url: '/api/v1/friends/requests',
    headers: aliceHeaders,
    payload: { username: 'PhotoReceiver' },
  });
  const requestId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: bobHeaders,
  })).json().incomingRequests[0].requestId;
  assert.equal((await app.inject({
    method: 'POST',
    url: `/api/v1/friends/requests/${requestId}/respond`,
    headers: bobHeaders,
    payload: { accept: true },
  })).statusCode, 200);
  const recipientUserId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: aliceHeaders,
  })).json().friends[0].userId;
  const photoPixels = randomBytes(1600 * 1200 * 3);
  const sourcePhoto = await sharp(photoPixels, {
    raw: { width: 1600, height: 1200, channels: 3 },
  }).png().toBuffer();
  assert.ok(sourcePhoto.length > 1024 * 1024 && sourcePhoto.length < 10 * 1024 * 1024);
  const upload = multipartPhoto(sourcePhoto, recipientUserId);
  upload.headers.authorization = `Bearer ${alice.accessToken}`;

  const sent = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/messages/photo',
    ...upload,
  });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.ok(sent.json().messageId);
  const photoExpiry = app.skinDatabase.prepare('SELECT expires_at AS expiresAt FROM ephemeral_messages WHERE id = ?')
    .get(sent.json().messageId).expiresAt;
  assert.ok(photoExpiry > Date.now() + 29 * 24 * 60 * 60 * 1000);
  assert.ok(photoExpiry <= Date.now() + 30 * 24 * 60 * 60 * 1000);
  const inbox = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/messages/inbox',
    headers: bobHeaders,
  });
  assert.equal(inbox.json().find((message) => message.messageId === sent.json().messageId).kind, 'photo');
  const photoPath = new URL(sent.json().photoUrl).pathname;
  const aliceUserId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: bobHeaders,
  })).json().friends[0].userId;
  const recipientConversation = `/api/v1/friends/messages/conversation/${aliceUserId}`;
  const senderConversation = `/api/v1/friends/messages/conversation/${recipientUserId}`;
  assert.equal((await app.inject({
    method: 'GET',
    url: recipientConversation,
    headers: bobHeaders,
  })).json()[0].photoViewedByMe, false);
  const senderPhoto = await app.inject({
    method: 'GET',
    url: `/api/v1/friends/messages/${sent.json().messageId}/photo`,
    headers: aliceHeaders,
  });
  assert.equal(senderPhoto.statusCode, 200);
  assert.equal(senderPhoto.headers['cache-control'], 'private, no-store');
  assert.ok(senderPhoto.rawPayload.length > 1024 * 1024);
  assert.equal((await app.inject({
    method: 'GET',
    url: senderConversation,
    headers: aliceHeaders,
  })).json()[0].photoViewedByMe, false);
  assert.equal((await app.inject({
    method: 'GET',
    url: recipientConversation,
    headers: bobHeaders,
  })).json()[0].photoViewedByMe, false);
  const senderPhotoAgain = await app.inject({
    method: 'GET',
    url: `/api/v1/friends/messages/${sent.json().messageId}/photo`,
    headers: aliceHeaders,
  });
  assert.equal(senderPhotoAgain.statusCode, 200);
  assert.deepEqual(senderPhotoAgain.rawPayload, senderPhoto.rawPayload);
  assert.equal((await app.inject({
    method: 'GET',
    url: `/api/v1/friends/messages/${sent.json().messageId}/photo`,
    headers: bearer((await createAccount('PhotoOutsider')).accessToken),
  })).statusCode, 404);
  const photo = await app.inject({ method: 'GET', url: photoPath });
  assert.equal(photo.statusCode, 200);
  assert.equal(photo.headers['content-type'], 'image/png');
  assert.ok(photo.rawPayload.length > 1024 * 1024);
  assert.ok(photo.rawPayload.length <= 5 * 1024 * 1024);
  assert.equal((await app.inject({ method: 'GET', url: photoPath })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'GET',
    url: recipientConversation,
    headers: bobHeaders,
  })).json()[0].photoViewedByMe, false);
  assert.equal((await app.inject({
    method: 'GET',
    url: `/api/v1/friends/messages/${sent.json().messageId}/photo`,
    headers: bobHeaders,
  })).statusCode, 200);
  const photoFileName = path.basename(new URL(sent.json().photoUrl).pathname);
  app.skinDatabase.prepare(`
    UPDATE ephemeral_messages SET expires_at = ? WHERE id = ?
  `).run(Date.now() - 1, sent.json().messageId);
  const expiredInbox = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/messages/inbox',
    headers: bobHeaders,
  });
  assert.equal(expiredInbox.json().some((message) => message.messageId === sent.json().messageId), false);
  await assert.rejects(readFile(path.join(dataDir, 'photos', photoFileName)), { code: 'ENOENT' });
});

test('repairs version 4 databases missing Minecraft username columns', async () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_normalized TEXT NOT NULL UNIQUE
      );
      INSERT INTO users (id, username, username_normalized)
      VALUES ('existing-user', 'ExistingUser', 'existinguser');
      PRAGMA user_version = 4;
    `);

    await migrateDatabase(database);

    const userColumns = new Set(database.pragma('table_info(users)').map((column) => column.name));
    assert.equal(userColumns.has('minecraft_username'), true);
    assert.equal(userColumns.has('minecraft_username_normalized'), true);
    assert.equal(database.prepare('SELECT username FROM users WHERE id = ?').get('existing-user').username, 'ExistingUser');
    assert.equal(database.pragma('user_version', { simple: true }), 15);
    await migrateDatabase(database);
    assert.equal(database.pragma('user_version', { simple: true }), 15);
    const messageColumns = new Set(database.pragma('table_info(ephemeral_messages)').map((column) => column.name));
    assert.equal(messageColumns.has('sender_photo_viewed_at'), true);
    assert.equal(messageColumns.has('recipient_photo_viewed_at'), true);
  } finally {
    database.close();
  }
});

test('preserves photo compatibility columns when migrating existing version 7 databases', async () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE presence (
        user_id TEXT PRIMARY KEY,
        in_game INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        server_name TEXT
      );
      CREATE TABLE ephemeral_messages (
        id TEXT PRIMARY KEY,
        sender_user_id TEXT NOT NULL,
        recipient_user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'text',
        photo_url TEXT
      );
      PRAGMA user_version = 7;
    `);

    await migrateDatabase(database);

    const messageColumns = new Set(database.pragma('table_info(ephemeral_messages)').map((column) => column.name));
    assert.equal(messageColumns.has('sender_photo_viewed_at'), true);
    assert.equal(messageColumns.has('recipient_photo_viewed_at'), true);
    assert.equal(database.pragma('user_version', { simple: true }), 15);
  } finally {
    database.close();
  }
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function register(username = 'SkinTester', email = `${username}@example.test`) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, email, password: 'correct horse battery staple' },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { response, email };
}

function multipartElytra(buffer, { contentType = 'image/png' } = {}) {
  const boundary = 'westron-elytra-api-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="elytra"; filename="elytra.png"\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function verify(email, token = mailTokens.verification.at(-1)) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    payload: { email, token },
  });
}

async function createAccount(username = 'SkinTester', email = `${username}@example.test`) {
  await register(username, email);
  const verified = await verify(email);
  assert.equal(verified.statusCode, 200, verified.body);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'correct horse battery staple' },
  });
  assert.equal(login.statusCode, 200, login.body);
  return login.json();
}

async function createPng(width = 64, height = 64, color = { r: 40, g: 80, b: 120, alpha: 1 }) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

function multipartSkin(buffer, { contentType = 'image/png' } = {}) {
  const boundary = 'westron-skin-api-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="skin"; filename="skin.png"\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function multipartCape(buffer, { contentType = 'image/png' } = {}) {
  const boundary = 'westron-skin-api-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="cape"; filename="cape.png"\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function multipartPhoto(buffer, recipientUserId) {
  const boundary = 'westron-photo-api-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="recipientUserId"\r\n\r\n${recipientUserId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function multipartGroupPhoto(buffer, { contentType = 'image/png' } = {}) {
  const boundary = 'westron-group-photo-api-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="group.png"\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

test('health, OpenAPI document and implemented routes are available', async () => {
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const documentResponse = await app.inject({ method: 'GET', url: '/api/openapi.yaml' });
  assert.equal(documentResponse.statusCode, 200);
  const document = parseYaml(documentResponse.body);
  assert.equal(document.openapi, '3.1.0');
  assert.equal(document.paths['/updates/{filename}']?.get?.operationId, 'downloadUpdateAsset');
  assert.equal(document.paths['/api/v1/admin/updates/{filename}']?.post?.operationId, 'publishUpdateAsset');
  assert.match(document.paths['/updates/{filename}'].get.parameters[0].schema.pattern, /Westron-Launcher-Setup-/);
  assert.match(document.paths['/api/v1/admin/updates/{filename}'].post.parameters[0].schema.pattern, /Westron-Launcher-Setup-/);
  assert.ok(document.components.schemas.Profile.required.includes('cape'));
  assert.ok(document.components.requestBodies.CapePng.content['multipart/form-data'].schema.required.includes('cape'));
  const resendOperation = document.paths['/api/v1/auth/resend-verification']?.post;
  assert.equal(resendOperation?.operationId, 'resendVerification');
  assert.ok(resendOperation.responses['503']);
  assert.equal(document.paths['/api/v1/auth/resend-verification']?.get, undefined);
  assert.equal(document.paths['/v1/auth/resend-verification'], undefined);
  assert.equal(document.paths['/api/v1/curseforge/mods/search'], undefined);
  assert.equal(document.paths['/api/v1/curseforge/mods/{modId}/files'], undefined);
  const compose = parseYaml(await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'));
  assert.equal(compose.services['westron-skin-api'].ports, undefined);
  assert.equal(compose.services['westron-skin-api'].environment.HOST, '0.0.0.0');
  assert.equal(compose.services['westron-skin-api'].volumes[0], 'skin-api-data:/data');
  assert.equal(compose.networks.proxy.external, true);

  for (const [route, pathName] of [
    ['GET /api/health', '/api/health'],
    ['GET /api/openapi.yaml', '/api/openapi.yaml'],
    ['POST /api/v1/auth/register', '/api/v1/auth/register'],
    ['POST /api/v1/auth/verify-email', '/api/v1/auth/verify-email'],
    ['POST /api/v1/auth/resend-verification', '/api/v1/auth/resend-verification'],
    ['POST /api/v1/auth/claim-legacy-account', '/api/v1/auth/claim-legacy-account'],
    ['POST /api/v1/auth/login', '/api/v1/auth/login'],
    ['POST /api/v1/auth/refresh', '/api/v1/auth/refresh'],
    ['POST /api/v1/auth/request-password-reset', '/api/v1/auth/request-password-reset'],
    ['POST /api/v1/auth/reset-password', '/api/v1/auth/reset-password'],
    ['POST /api/v1/auth/logout', '/api/v1/auth/logout'],
    ['GET /api/v1/me', '/api/v1/me'],
    ['GET /api/v1/friends', '/api/v1/friends'],
    ['GET /api/v1/friends/search', '/api/v1/friends/search'],
    ['POST /api/v1/friends/requests', '/api/v1/friends/requests'],
    ['DELETE /api/v1/friends/requests/{requestId}', '/api/v1/friends/requests/:requestId'],
    ['POST /api/v1/friends/requests/{requestId}/respond', '/api/v1/friends/requests/:requestId/respond'],
    ['DELETE /api/v1/friends/{friendUserId}', '/api/v1/friends/:friendUserId'],
    ['GET /api/v1/friends/groups', '/api/v1/friends/groups'],
    ['POST /api/v1/friends/groups', '/api/v1/friends/groups'],
    ['DELETE /api/v1/friends/groups/{groupId}', '/api/v1/friends/groups/:groupId'],
    ['PATCH /api/v1/friends/groups/{groupId}', '/api/v1/friends/groups/:groupId'],
    ['DELETE /api/v1/friends/groups/{groupId}/members/{memberUserId}', '/api/v1/friends/groups/:groupId/members/:memberUserId'],
    ['GET /api/v1/friends/groups/{groupId}/messages', '/api/v1/friends/groups/:groupId/messages'],
    ['POST /api/v1/friends/groups/{groupId}/messages', '/api/v1/friends/groups/:groupId/messages'],
    ['POST /api/v1/friends/groups/{groupId}/messages/{messageId}/recall', '/api/v1/friends/groups/:groupId/messages/:messageId/recall'],
    ['POST /api/v1/friends/groups/{groupId}/messages/photo', '/api/v1/friends/groups/:groupId/messages/photo'],
    ['GET /api/v1/friends/groups/{groupId}/messages/{messageId}/photo', '/api/v1/friends/groups/:groupId/messages/:messageId/photo'],
    ['POST /api/v1/presence', '/api/v1/presence'],
    ['POST /api/v1/friends/messages', '/api/v1/friends/messages'],
    ['DELETE /api/v1/friends/messages/{messageId}', '/api/v1/friends/messages/:messageId'],
    ['POST /api/v1/friends/messages/{messageId}/recall', '/api/v1/friends/messages/:messageId/recall'],
    ['POST /api/v1/friends/messages/photo', '/api/v1/friends/messages/photo'],
    ['GET /api/v1/friends/messages/photo/{photoFileName}', '/api/v1/friends/messages/photo/:photoFileName'],
    ['GET /api/v1/friends/messages/{messageId}/photo', '/api/v1/friends/messages/:messageId/photo'],
    ['GET /api/v1/friends/messages/inbox', '/api/v1/friends/messages/inbox'],
    ['POST /api/v1/friends/messages/{messageId}/consume', '/api/v1/friends/messages/:messageId/consume'],
    ['GET /api/v1/friends/calls/ice-servers', '/api/v1/friends/calls/ice-servers'],
    ['POST /api/v1/friends/calls/signals', '/api/v1/friends/calls/signals'],
    ['GET /api/v1/friends/calls/signals', '/api/v1/friends/calls/signals'],
    ['PUT /api/v1/me/minecraft-profile', '/api/v1/me/minecraft-profile'],
    ['POST /api/v1/me/skin', '/api/v1/me/skin'],
    ['PUT /api/v1/me/skin', '/api/v1/me/skin'],
    ['DELETE /api/v1/me/skin', '/api/v1/me/skin'],
    ['POST /api/v1/me/cape', '/api/v1/me/cape'],
    ['PUT /api/v1/me/cape', '/api/v1/me/cape'],
    ['DELETE /api/v1/me/cape', '/api/v1/me/cape'],
    ['POST /api/v1/me/elytra', '/api/v1/me/elytra'],
    ['PUT /api/v1/me/elytra', '/api/v1/me/elytra'],
    ['DELETE /api/v1/me/elytra', '/api/v1/me/elytra'],
    ['GET /api/v1/profiles/{username}', '/api/v1/profiles/:username'],
    ['GET /api/v1/profiles/{username}/skin.png', '/api/v1/profiles/:username/skin.png'],
    ['GET /api/v1/profiles/{username}/cape.png', '/api/v1/profiles/:username/cape.png'],
    ['GET /api/v1/profiles/{username}/elytra.png', '/api/v1/profiles/:username/elytra.png'],
    ['GET /updates/{filename}', '/updates/:filename'],
    ['POST /api/v1/admin/updates/{filename}', '/api/v1/admin/updates/:filename'],
  ]) {
    const [method] = route.split(' ');
    assert.ok(app.hasRoute({ method, url: pathName }), `Missing implementation for ${route}`);
    const [documentMethod, documentPath] = route.split(' ');
    assert.ok(document.paths[documentPath]?.[documentMethod.toLowerCase()], `Missing OpenAPI operation ${route}`);
  }
  const removedRoute = await app.inject({
    method: 'GET',
    url: '/api/v1/curseforge/mods/search',
  });
  assert.equal(removedRoute.statusCode, 404);
});

test('supports friend requests, friend-only presence, one-time messages and call signalling', async () => {
  const alice = await createAccount('Alice');
  const bob = await createAccount('Bob');
  const outsider = await createAccount('Outsider');
  const underscored = await createAccount('B_b');
  const aliceHeaders = bearer(alice.accessToken);
  const bobHeaders = bearer(bob.accessToken);

  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/friends' })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/friends/requests',
    headers: aliceHeaders,
    payload: { username: 'Alice' },
  })).statusCode, 400);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/friends/requests',
    headers: aliceHeaders,
    payload: { username: 'NoSuchUser' },
  })).statusCode, 404);

  const initialSuggestions = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/search',
    headers: aliceHeaders,
  });

  async function verifyGroupConversations() {
    const alice = await createAccount('GroupOwner');
    const bob = await createAccount('GroupMember');
    const charlie = await createAccount('GroupGuest');
    const outsider = await createAccount('GroupOutsider');
    const aliceHeaders = bearer(alice.accessToken);
    const bobHeaders = bearer(bob.accessToken);
    const charlieHeaders = bearer(charlie.accessToken);
    const outsiderHeaders = bearer(outsider.accessToken);

    for (const [senderHeaders, recipientHeaders, recipientName] of [
      [aliceHeaders, bobHeaders, 'GroupMember'],
      [aliceHeaders, charlieHeaders, 'GroupGuest'],
    ]) {
      const sentRequest = await app.inject({
        method: 'POST',
        url: '/api/v1/friends/requests',
        headers: senderHeaders,
        payload: { username: recipientName },
      });
      assert.equal(sentRequest.statusCode, 201, sentRequest.body);
      const requestId = (await app.inject({
        method: 'GET',
        url: '/api/v1/friends',
        headers: recipientHeaders,
      })).json().incomingRequests[0].requestId;
      assert.equal((await app.inject({
        method: 'POST',
        url: `/api/v1/friends/requests/${requestId}/respond`,
        headers: recipientHeaders,
        payload: { accept: true },
      })).statusCode, 200);
    }

    const aliceFriends = (await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: aliceHeaders,
    })).json().friends;
    const bobId = aliceFriends.find(({ username }) => username === 'GroupMember').userId;
    const charlieId = aliceFriends.find(({ username }) => username === 'GroupGuest').userId;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/groups',
      headers: aliceHeaders,
      payload: { name: 'Weekend group', memberUserIds: [bobId, charlieId] },
    });
    assert.equal(created.statusCode, 201, created.body);
    const groupId = created.json().groupId;
    const groupCallSignal = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/calls/signals',
      headers: bobHeaders,
      payload: {
        recipientUserId: charlieId,
        groupId,
        callId: '123e4567-e89b-12d3-a456-426614174001',
        type: 'offer',
        sdp: 'v=0\r\n',
      },
    });
    assert.equal(groupCallSignal.statusCode, 202, groupCallSignal.body);
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v1/friends/calls/signals',
      headers: bobHeaders,
      payload: {
        recipientUserId: app.skinDatabase.prepare('SELECT id FROM users WHERE username = ?').get('GroupOutsider').id,
        groupId,
        callId: '123e4567-e89b-12d3-a456-426614174002',
        type: 'offer',
        sdp: 'v=0\r\n',
      },
    })).statusCode, 404);
    const groupSignals = await app.inject({
      method: 'GET',
      url: '/api/v1/friends/calls/signals',
      headers: charlieHeaders,
    });
    assert.equal(groupSignals.json()[0].groupId, groupId);

    const bobGroups = await app.inject({
      method: 'GET',
      url: '/api/v1/friends/groups',
      headers: bobHeaders,
    });
    assert.deepEqual(bobGroups.json()[0].members.map(({ username }) => username), [
      'GroupGuest', 'GroupMember', 'GroupOwner',
    ]);
    const ownerId = bobGroups.json()[0].members.find(({ username }) => username === 'GroupOwner').userId;
    assert.equal(bobGroups.json()[0].createdByUserId, ownerId);
    assert.equal((await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: outsiderHeaders,
      payload: { body: 'Not a member' },
    })).statusCode, 404);

    const firstMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: bobHeaders,
      payload: { body: 'Hello group' },
    });
    assert.equal(firstMessage.statusCode, 201, firstMessage.body);
    const secondMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: aliceHeaders,
      payload: { body: 'Welcome' },
    });
    assert.equal(secondMessage.statusCode, 201, secondMessage.body);
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: charlieHeaders,
    });
    assert.deepEqual(messages.json().map(({ body }) => body), ['Hello group', 'Welcome']);
    const recallFirstMessageUrl = `/api/v1/friends/groups/${groupId}/messages/${firstMessage.json().messageId}/recall`;
    assert.equal((await app.inject({
      method: 'POST',
      url: recallFirstMessageUrl,
      headers: aliceHeaders,
    })).statusCode, 404);
    assert.equal((await app.inject({
      method: 'POST',
      url: recallFirstMessageUrl,
      headers: outsiderHeaders,
    })).statusCode, 404);
    assert.deepEqual((await app.inject({
      method: 'POST',
      url: recallFirstMessageUrl,
      headers: bobHeaders,
    })).json(), { recalled: true });
    const afterRecall = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: charlieHeaders,
    });
    assert.deepEqual(afterRecall.json().map(({ body }) => body), ['Welcome']);

    const groupPhotoUpload = multipartGroupPhoto(await createPng());
    Object.assign(groupPhotoUpload.headers, bobHeaders);
    const uploadedPhoto = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages/photo`,
      ...groupPhotoUpload,
    });
    assert.equal(uploadedPhoto.statusCode, 201, uploadedPhoto.body);
    assert.equal(uploadedPhoto.json().kind, 'photo');
    const photoMessageId = uploadedPhoto.json().messageId;
    const photoMessages = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: charlieHeaders,
    });
    assert.equal(photoMessages.json().at(-1).kind, 'photo');
    const memberPhoto = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages/${photoMessageId}/photo`,
      headers: charlieHeaders,
    });
    assert.equal(memberPhoto.statusCode, 200);
    assert.equal(memberPhoto.headers['content-type'], 'image/png');
    assert.equal((await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages/${photoMessageId}/photo`,
      headers: outsiderHeaders,
    })).statusCode, 404);
    const outsiderPhotoUpload = multipartGroupPhoto(await createPng());
    Object.assign(outsiderPhotoUpload.headers, outsiderHeaders);
    assert.equal((await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages/photo`,
      ...outsiderPhotoUpload,
    })).statusCode, 404);
    const groupPhotoFileName = app.skinDatabase.prepare(`
      SELECT photo_file_name AS photoFileName FROM friend_group_messages WHERE id = ?
    `).get(photoMessageId).photoFileName;
    assert.equal((await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages/${photoMessageId}/recall`,
      headers: aliceHeaders,
    })).statusCode, 404);
    app.skinDatabase.prepare('UPDATE friend_group_messages SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), photoMessageId);
    const afterPhotoExpiry = await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages`,
      headers: charlieHeaders,
    });
    assert.equal(afterPhotoExpiry.json().some((message) => message.messageId === photoMessageId), false);
    assert.equal((await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${groupId}/messages/${photoMessageId}/photo`,
      headers: charlieHeaders,
    })).statusCode, 404);
    await assert.rejects(readFile(path.join(dataDir, 'photos', groupPhotoFileName)), { code: 'ENOENT' });

    const recallPhotoUpload = multipartGroupPhoto(await createPng());
    Object.assign(recallPhotoUpload.headers, bobHeaders);
    const recallPhoto = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages/photo`,
      ...recallPhotoUpload,
    });
    assert.equal(recallPhoto.statusCode, 201, recallPhoto.body);
    const recallPhotoId = recallPhoto.json().messageId;
    const recallPhotoFileName = app.skinDatabase.prepare(`
      SELECT photo_file_name AS photoFileName FROM friend_group_messages WHERE id = ?
    `).get(recallPhotoId).photoFileName;
    assert.deepEqual((await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${groupId}/messages/${recallPhotoId}/recall`,
      headers: bobHeaders,
    })).json(), { recalled: true });
    await assert.rejects(readFile(path.join(dataDir, 'photos', recallPhotoFileName)), { code: 'ENOENT' });

    const directMessage = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/messages',
      headers: aliceHeaders,
      payload: { recipientUserId: bobId, body: 'Recall me' },
    });
    assert.equal(directMessage.statusCode, 201);
    assert.equal((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/messages/${directMessage.json().messageId}`,
      headers: bobHeaders,
    })).statusCode, 404);
    assert.deepEqual((await app.inject({
      method: 'POST',
      url: `/api/v1/friends/messages/${directMessage.json().messageId}/recall`,
      headers: aliceHeaders,
    })).json(), { recalled: true });

    const realNow = Date.now;
    const cooldownExpiredAt = realNow() + 5_001;
    Date.now = () => cooldownExpiredAt;
    let legacyRecallMessage;
    try {
      legacyRecallMessage = await app.inject({
        method: 'POST',
        url: '/api/v1/friends/messages',
        headers: aliceHeaders,
        payload: { recipientUserId: bobId, body: 'Legacy recall route' },
      });
      assert.equal(legacyRecallMessage.statusCode, 201, legacyRecallMessage.body);
    } finally {
      Date.now = realNow;
    }
    assert.deepEqual((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/messages/${legacyRecallMessage.json().messageId}`,
      headers: aliceHeaders,
    })).json(), { recalled: true });

    assert.equal((await app.inject({
      method: 'PATCH',
      url: `/api/v1/friends/groups/${groupId}`,
      headers: bobHeaders,
      payload: { name: 'Unauthorized rename' },
    })).statusCode, 403);
    assert.deepEqual((await app.inject({
      method: 'PATCH',
      url: `/api/v1/friends/groups/${groupId}`,
      headers: aliceHeaders,
      payload: { name: 'Renamed group' },
    })).json(), { groupId, name: 'Renamed group' });
    assert.equal((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${groupId}/members/${charlieId}`,
      headers: bobHeaders,
    })).statusCode, 403);

    assert.deepEqual((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${groupId}/members/${ownerId}`,
      headers: aliceHeaders,
    })).json(), { removed: true, groupDeleted: false });
    const transferredGroup = (await app.inject({
      method: 'GET',
      url: '/api/v1/friends/groups',
      headers: bobHeaders,
    })).json()[0];
    assert.ok([bobId, charlieId].includes(transferredGroup.ownerUserId));
    const newOwnerId = transferredGroup.ownerUserId;
    const newOwnerHeaders = newOwnerId === bobId ? bobHeaders : charlieHeaders;
    assert.equal((await app.inject({
      method: 'PATCH',
      url: `/api/v1/friends/groups/${groupId}`,
      headers: newOwnerHeaders,
      payload: { name: 'Unauthorized after handoff' },
    })).statusCode, 403);
    const remainingMemberId = newOwnerId === bobId ? charlieId : bobId;
    assert.equal((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${groupId}/members/${remainingMemberId}`,
      headers: newOwnerHeaders,
    })).json().groupDeleted, false);
    assert.deepEqual((await app.inject({
      method: 'GET',
      url: '/api/v1/friends/groups',
      headers: remainingMemberId === bobId ? bobHeaders : charlieHeaders,
    })).json(), []);
    assert.deepEqual((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${groupId}/members/${newOwnerId}`,
      headers: newOwnerHeaders,
    })).json(), { removed: true, groupDeleted: true });

    const removableGroup = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/groups',
      headers: aliceHeaders,
      payload: { name: 'Group to delete', memberUserIds: [bobId] },
    });
    const removableGroupId = removableGroup.json().groupId;
    const removablePhotoUpload = multipartGroupPhoto(await createPng());
    Object.assign(removablePhotoUpload.headers, aliceHeaders);
    const removablePhoto = await app.inject({
      method: 'POST',
      url: `/api/v1/friends/groups/${removableGroupId}/messages/photo`,
      ...removablePhotoUpload,
    });
    const removablePhotoFileName = app.skinDatabase.prepare(`
      SELECT photo_file_name AS photoFileName FROM friend_group_messages WHERE id = ?
    `).get(removablePhoto.json().messageId).photoFileName;
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v1/friends/calls/signals',
      headers: aliceHeaders,
      payload: {
        recipientUserId: bobId,
        groupId: removableGroupId,
        callId: '123e4567-e89b-12d3-a456-426614174003',
        type: 'offer',
        sdp: 'v=0\r\n',
      },
    })).statusCode, 202);
    assert.equal((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${removableGroupId}`,
      headers: bobHeaders,
    })).statusCode, 403);
    assert.equal((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${removableGroupId}`,
      headers: outsiderHeaders,
    })).statusCode, 404);
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v1/friends/calls/signals',
      headers: aliceHeaders,
      payload: {
        recipientUserId: bobId,
        groupId: removableGroupId,
        callId: '123e4567-e89b-12d3-a456-426614174003',
        type: 'hangup',
        sdp: '',
      },
    })).statusCode, 202);
    assert.deepEqual((await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/groups/${removableGroupId}`,
      headers: aliceHeaders,
    })).json(), { deleted: true });
    assert.deepEqual(app.skinDatabase.prepare('SELECT type FROM call_signals WHERE group_id = ?')
      .all(removableGroupId).map(({ type }) => type), ['hangup']);
    app.skinDatabase.prepare('DELETE FROM call_signals WHERE group_id = ?').run(removableGroupId);
    for (const type of ['hangup', 'reject']) {
      const staleCleanup = await app.inject({
        method: 'POST',
        url: '/api/v1/friends/calls/signals',
        headers: aliceHeaders,
        payload: {
          recipientUserId: bobId,
          groupId: removableGroupId,
          callId: '123e4567-e89b-12d3-a456-426614174003',
          type,
          sdp: '',
        },
      });
      assert.equal(staleCleanup.statusCode, 200, staleCleanup.body);
      assert.deepEqual(staleCleanup.json(), { sent: false });
    }
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v1/friends/calls/signals',
      headers: aliceHeaders,
      payload: {
        recipientUserId: bobId,
        groupId: removableGroupId,
        callId: '123e4567-e89b-12d3-a456-426614174003',
        type: 'offer',
        sdp: 'v=0\r\n',
      },
    })).statusCode, 404);
    assert.equal((await app.inject({
      method: 'GET',
      url: `/api/v1/friends/groups/${removableGroupId}/messages`,
      headers: bobHeaders,
    })).statusCode, 404);
    assert.equal(app.skinDatabase.prepare('SELECT COUNT(*) AS count FROM call_signals WHERE group_id = ?')
      .get(removableGroupId).count, 0);
    await assert.rejects(readFile(path.join(dataDir, 'photos', removablePhotoFileName)), { code: 'ENOENT' });
  }
  assert.equal(initialSuggestions.statusCode, 200);
  assert.deepEqual(initialSuggestions.json().map(({ username }) => username), ['B_b', 'Bob', 'Outsider']);
  const prefixSuggestions = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/search?q=bo',
    headers: aliceHeaders,
  });
  assert.deepEqual(prefixSuggestions.json().map(({ username }) => username), ['Bob']);
  const underscoreSuggestions = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/search?q=b_',
    headers: aliceHeaders,
  });
  assert.deepEqual(underscoreSuggestions.json().map(({ username }) => username), ['B_b']);

  const cancellable = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/requests',
    headers: aliceHeaders,
    payload: { username: 'B_b' },
  });
  assert.equal(cancellable.statusCode, 201);
  const cancellableId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: aliceHeaders,
  })).json().outgoingRequests[0].requestId;
  assert.equal((await app.inject({
    method: 'DELETE',
    url: `/api/v1/friends/requests/${cancellableId}`,
    headers: bearer(underscored.accessToken),
  })).statusCode, 404);
  assert.deepEqual((await app.inject({
    method: 'DELETE',
    url: `/api/v1/friends/requests/${cancellableId}`,
    headers: aliceHeaders,
  })).json(), { cancelled: true });
  assert.equal((await app.inject({
    method: 'DELETE',
    url: `/api/v1/friends/requests/${cancellableId}`,
    headers: aliceHeaders,
  })).statusCode, 404);

  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/requests',
    headers: aliceHeaders,
    payload: { username: 'bOB' },
  });
  assert.equal(request.statusCode, 201, request.body);
  const pendingSuggestions = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/search?q=bo',
    headers: aliceHeaders,
  });
  assert.deepEqual(pendingSuggestions.json(), []);
  const requestId = (await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: bobHeaders,
  })).json().incomingRequests[0].requestId;
  assert.equal((await app.inject({
    method: 'POST',
    url: `/api/v1/friends/requests/${requestId}/respond`,
    headers: bearer(outsider.accessToken),
    payload: { accept: true },
  })).statusCode, 404);
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/v1/friends/requests/${requestId}/respond`,
    headers: bobHeaders,
    payload: { accept: true },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const acceptedFriendSuggestions = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/search?q=bo',
    headers: aliceHeaders,
  });
  assert.deepEqual(acceptedFriendSuggestions.json(), []);

  const presence = await app.inject({
    method: 'POST',
    url: '/api/v1/presence',
    headers: bobHeaders,
    payload: { inGame: true },
  });
  assert.equal(presence.statusCode, 200, presence.body);
  assert.deepEqual(presence.json(), { updated: true });
  assert.equal((await app.inject({
    method: 'PUT',
    url: '/api/v1/me/minecraft-profile',
    headers: bobHeaders,
    payload: { username: 'MinecraftBob' },
  })).statusCode, 200);
  const friendList = await app.inject({ method: 'GET', url: '/api/v1/friends', headers: aliceHeaders });
  const bobFriend = friendList.json().friends[0];
  assert.equal(bobFriend.username, 'Bob');
  assert.equal(bobFriend.minecraftUsername, 'MinecraftBob');
  assert.equal(bobFriend.online, true);
  assert.equal(bobFriend.inGame, true);

  const message = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/messages',
    headers: aliceHeaders,
    payload: { recipientUserId: bobFriend.userId, body: 'Hello, one-time message.' },
  });
  assert.equal(message.statusCode, 201, message.body);
  const forbiddenMessage = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/messages',
    headers: bearer(outsider.accessToken),
    payload: { recipientUserId: friendList.json().friends[0].userId, body: 'Not allowed' },
  });
  assert.equal(forbiddenMessage.statusCode, 404);

  const inbox = await app.inject({ method: 'GET', url: '/api/v1/friends/messages/inbox', headers: bobHeaders });
  assert.equal(inbox.statusCode, 200, inbox.body);
  assert.equal(inbox.json().length, 1);
  assert.equal(inbox.json()[0].kind, 'text');
  assert.equal(Object.prototype.hasOwnProperty.call(inbox.json()[0], 'body'), false);
  const consumed = await app.inject({
    method: 'POST',
    url: `/api/v1/friends/messages/${message.json().messageId}/consume`,
    headers: bobHeaders,
  });
  assert.equal(consumed.statusCode, 200, consumed.body);
  assert.equal(consumed.json().body, 'Hello, one-time message.');
  assert.equal((await app.inject({
    method: 'POST',
    url: `/api/v1/friends/messages/${message.json().messageId}/consume`,
    headers: bobHeaders,
  })).statusCode, 200);

  const iceServers = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/calls/ice-servers',
    headers: aliceHeaders,
  });
  assert.equal(iceServers.statusCode, 200, iceServers.body);
  assert.ok(iceServers.json().iceServers.some((server) => server.urls.some((url) => url.startsWith('stun:'))));

  const callId = '123e4567-e89b-12d3-a456-426614174000';
  const offer = await app.inject({
    method: 'POST',
    url: '/api/v1/friends/calls/signals',
    headers: aliceHeaders,
    payload: { recipientUserId: bobFriend.userId, callId, type: 'offer', sdp: 'v=0\r\n' },
  });
  assert.equal(offer.statusCode, 202, offer.body);
  const candidate = {
    candidate: 'candidate:1 1 UDP 2122252543 192.0.2.1 5000 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'test',
  };
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/friends/calls/signals',
    headers: aliceHeaders,
    payload: { recipientUserId: bobFriend.userId, callId, type: 'candidate', sdp: JSON.stringify(candidate) },
  })).statusCode, 202);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/friends/calls/signals',
    headers: aliceHeaders,
    payload: { recipientUserId: bobFriend.userId, callId, type: 'candidate', sdp: '{invalid' },
  })).statusCode, 400);
  const bobSignals = await app.inject({
    method: 'GET',
    url: '/api/v1/friends/calls/signals',
    headers: bobHeaders,
  });
  assert.equal(bobSignals.statusCode, 200, bobSignals.body);
  assert.equal(bobSignals.json()[0].type, 'offer');
  assert.equal(bobSignals.json()[0].sdp, 'v=0\r\n');
  assert.equal(bobSignals.json()[1].type, 'candidate');
  assert.deepEqual(JSON.parse(bobSignals.json()[1].sdp), candidate);
  assert.deepEqual((await app.inject({
    method: 'GET',
    url: '/api/v1/friends/calls/signals',
    headers: aliceHeaders,
  })).json(), []);

  const realNow = Date.now;
  const messageCooldownExpiredAt = realNow() + 5_001;
  Date.now = () => messageCooldownExpiredAt;
  try {
    const pendingMessage = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/messages',
      headers: aliceHeaders,
      payload: { recipientUserId: bobFriend.userId, body: 'Removed with friendship' },
    });
    assert.equal(pendingMessage.statusCode, 201, pendingMessage.body);
  } finally {
    Date.now = realNow;
  }
  const pendingCallId = '223e4567-e89b-12d3-a456-426614174000';
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/friends/calls/signals',
    headers: aliceHeaders,
    payload: { recipientUserId: bobFriend.userId, callId: pendingCallId, type: 'offer', sdp: 'v=0\r\n' },
  })).statusCode, 202);

  app.skinDatabase.prepare('UPDATE presence SET last_seen_at = ?, in_game = 1 WHERE user_id = ?')
    .run(Date.now() - 60_000, bobFriend.userId);
  const stalePresence = await app.inject({ method: 'GET', url: '/api/v1/friends', headers: aliceHeaders });
  assert.equal(stalePresence.json().friends[0].online, false);
  assert.equal(stalePresence.json().friends[0].inGame, false);

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/v1/friends/${bobFriend.userId}`,
    headers: aliceHeaders,
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v1/friends', headers: aliceHeaders })).json().friends, []);
  assert.deepEqual((await app.inject({
    method: 'GET',
    url: '/api/v1/friends/messages/inbox',
    headers: bobHeaders,
  })).json(), []);
  assert.deepEqual((await app.inject({
    method: 'GET',
    url: '/api/v1/friends/calls/signals',
    headers: bobHeaders,
  })).json(), []);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/friends/messages',
    headers: aliceHeaders,
    payload: { recipientUserId: bobFriend.userId, body: 'After removal' },
  })).statusCode, 404);
  await verifyGroupConversations();
});

test('links Minecraft names to Westron profiles for public skin and cape lookup', async () => {
  const account = await createAccount('WestronOwner');
  const link = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/minecraft-profile',
    headers: bearer(account.accessToken),
    payload: { username: 'MineCraftNick' },
  });
  assert.equal(link.statusCode, 200, link.body);

  const skinRequest = multipartSkin(await createPng());
  Object.assign(skinRequest.headers, bearer(account.accessToken));
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...skinRequest })).statusCode, 201);
  const capeRequest = multipartCape(await createPng(64, 32));
  Object.assign(capeRequest.headers, bearer(account.accessToken));
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/cape', ...capeRequest })).statusCode, 201);

  const profile = await app.inject({ method: 'GET', url: '/api/v1/profiles/minecraftNick' });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().username, 'WestronOwner');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/profiles/MineCraftNick/skin.png' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/profiles/MineCraftNick/cape.png' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/skin/profile/texture/login/MineCraftNick' })).statusCode, 200);

  const duplicateLink = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/minecraft-profile',
    headers: bearer(account.accessToken),
    payload: { username: 'another!' },
  });
  assert.equal(duplicateLink.statusCode, 400);

  const otherAccount = await createAccount('OtherOwner');
  const conflictingLink = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/minecraft-profile',
    headers: bearer(otherAccount.accessToken),
    payload: { username: 'minecraftnick' },
  });
  assert.equal(conflictingLink.statusCode, 409);

  const usernameCollision = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: 'MinecraftNick',
      email: 'alias-collision@example.test',
      password: 'correct horse battery staple',
    },
  });
  assert.equal(usernameCollision.statusCode, 409);
});

test('only the fixed verified publisher can upload releases, regardless of environment overrides', async () => {
  const owner = await createAccount('ReleaseOwner', 'ermiscaner78@gmail.com');
  const otherAccount = await createAccount('RegularUpdater', 'regular@example.test');
  const installer = Buffer.from('test installer payload');
  const hash = createHash('sha512').update(installer).digest('base64');
  const filename = 'Westron-Client-Setup-1.0.1.exe';
  const manifest = Buffer.from([
    'version: 1.0.1',
    'files:',
    `  - url: ${filename}`,
    `    sha512: ${hash}`,
    `    size: ${installer.length}`,
    `path: ${filename}`,
    `sha512: ${hash}`,
    '',
  ].join('\n'));
  const blockmap = Buffer.from('test blockmap');
  const upload = (fileName, contents, token) => app.inject({
    method: 'POST',
    url: `/api/v1/admin/updates/${encodeURIComponent(fileName)}`,
    headers: { ...bearer(token), 'content-type': 'application/vnd.westron.update' },
    payload: contents,
  });

  const forbidden = await upload(filename, installer, otherAccount.accessToken);
  assert.equal(forbidden.statusCode, 403);

  assert.equal((await upload(filename, installer, owner.accessToken)).statusCode, 200);
  assert.equal((await upload(`${filename}.blockmap`, blockmap, owner.accessToken)).statusCode, 200);
  const invalidManifest = await upload('latest.yml', Buffer.from('version: 1.0.2\n'), owner.accessToken);
  assert.equal(invalidManifest.statusCode, 400);

  const published = await upload('latest.yml', manifest, owner.accessToken);
  assert.equal(published.statusCode, 200, published.body);
  const feed = await app.inject({ method: 'GET', url: '/updates/latest.yml' });
  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body, manifest.toString());
  const downloadedInstaller = await app.inject({ method: 'GET', url: `/updates/${encodeURIComponent(filename)}` });
  assert.equal(downloadedInstaller.statusCode, 200);
  assert.equal(downloadedInstaller.rawPayload.toString(), installer.toString());
  assert.equal((await app.inject({ method: 'GET', url: '/updates/../../schema.sql' })).statusCode, 404);
});

test('publishes and serves launcher-named update assets', async () => {
  const owner = await createAccount('LauncherOwner', 'ermiscaner78@gmail.com');
  const filename = 'Westron-Launcher-Setup-1.0.3.exe';
  const installer = Buffer.from('launcher installer payload');
  const hash = createHash('sha512').update(installer).digest('base64');
  const manifest = Buffer.from([
    'version: 1.0.3',
    'files:',
    `  - url: ${filename}`,
    `    sha512: ${hash}`,
    `    size: ${installer.length}`,
    `path: ${filename}`,
    `sha512: ${hash}`,
    '',
  ].join('\n'));
  const upload = (fileName, contents) => app.inject({
    method: 'POST',
    url: `/api/v1/admin/updates/${encodeURIComponent(fileName)}`,
    headers: { ...bearer(owner.accessToken), 'content-type': 'application/vnd.westron.update' },
    payload: contents,
  });

  assert.equal((await upload(filename, installer)).statusCode, 200);
  assert.equal((await upload(`${filename}.blockmap`, Buffer.from('launcher blockmap'))).statusCode, 200);
  const published = await upload('latest.yml', manifest);
  assert.equal(published.statusCode, 200, published.body);

  const downloadedInstaller = await app.inject({ method: 'GET', url: `/updates/${encodeURIComponent(filename)}` });
  assert.equal(downloadedInstaller.statusCode, 200);
  assert.equal(downloadedInstaller.rawPayload.toString(), installer.toString());
});

test('registration requires one-time email verification and login stores Argon2id credentials', async () => {
  const { response, email } = await register();
  assert.match(response.json().message, /doğrulayın/i);
  const account = app.skinDatabase.prepare('SELECT email_verified, password_hash, password_salt, password_algorithm FROM users').get();
  assert.equal(account.email_verified, 0);
  assert.equal(account.password_algorithm, 'argon2id');
  assert.match(account.password_hash, /^\$argon2id\$/);
  assert.equal(account.password_salt, '');

  const unverifiedLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'correct horse battery staple' },
  });
  assert.equal(unverifiedLogin.statusCode, 403);

  const rawToken = mailTokens.verification[0];
  assert.match(rawToken, /^\d{6}$/);
  const storedHash = app.skinDatabase.prepare('SELECT token_hash FROM email_verification_tokens').get().token_hash;
  assert.notEqual(storedHash, rawToken);
  assert.equal(storedHash, createHash('sha256').update(rawToken).digest('hex'));
  const verified = await verify(email, rawToken);
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal((await verify(email, rawToken)).statusCode, 404);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: email.toUpperCase(), password: 'correct horse battery staple' },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.ok(login.json().accessToken);
  assert.ok(login.json().refreshToken);
  assert.equal(login.json().tokenType, 'Bearer');
  assert.equal(login.json().expiresIn, 900);
});

test('refresh tokens rotate once and replay revokes the session', async () => {
  const account = await createAccount();
  const refresh = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: account.refreshToken },
  });
  assert.equal(refresh.statusCode, 200, refresh.body);
  assert.notEqual(refresh.json().refreshToken, account.refreshToken);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(account.accessToken) })).statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: account.refreshToken },
  });
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'refresh_token_reuse');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(refresh.json().accessToken) })).statusCode, 401);
});

test('access and refresh tokens expire at the session deadline', async () => {
  const account = await createAccount('SessionExpiry');
  const refreshRow = app.skinDatabase.prepare('SELECT session_id FROM refresh_tokens WHERE token_hash = ?')
    .get(hashToken(account.refreshToken));
  assert.ok(refreshRow);
  app.skinDatabase.prepare('UPDATE sessions SET refresh_expires_at = ? WHERE id = ?')
    .run(Date.now() - 1, refreshRow.session_id);

  const access = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: bearer(account.accessToken),
  });
  assert.equal(access.statusCode, 401);

  const refresh = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: account.refreshToken },
  });
  assert.equal(refresh.statusCode, 401);
});

test('password reset is one-time and revokes all existing sessions', async () => {
  const account = await createAccount('ResetUser');
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/request-password-reset',
    payload: { email: 'resetuser@example.test' },
  });
  assert.equal(request.statusCode, 200);
  const token = mailTokens.reset[0];
  assert.match(token, /^\d{6}$/);
  const reset = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/reset-password',
    payload: { email: 'RESETUSER@example.test', token, newPassword: 'an entirely new secure password' },
  });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(account.accessToken) })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/auth/reset-password',
    payload: { email: 'resetuser@example.test', token, newPassword: 'another entirely new password' },
  })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'resetuser@example.test', password: 'an entirely new secure password' },
  })).statusCode, 200);

  await createAccount('ResetRace');
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/request-password-reset',
    payload: { email: 'resetrace@example.test' },
  });
  const raceToken = mailTokens.reset.at(-1);
  const resetRace = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { email: 'resetrace@example.test', token: raceToken, newPassword: 'concurrent password one' },
    }),
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { email: 'resetrace@example.test', token: raceToken, newPassword: 'concurrent password two' },
    }),
  ]);
  assert.deepEqual(resetRace.map((response) => response.statusCode).sort(), [200, 404]);
});

test('skin upload and public profile flow only works for verified accounts', async () => {
  const { email } = await register('SkinOwner');
  const unverified = await app.inject({
    method: 'POST',
    url: '/api/v1/me/skin',
    ...multipartSkin(await createPng()),
  });
  assert.equal(unverified.statusCode, 401);
  assert.equal((await verify(email)).statusCode, 200);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'correct horse battery staple' },
  });
  const firstPng = await createPng();
  const firstRequest = multipartSkin(firstPng);
  firstRequest.headers.authorization = `Bearer ${login.json().accessToken}`;
  firstRequest.headers['x-skin-model'] = 'slim';
  const upload = await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...firstRequest });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().skin.model, 'slim');
  assert.equal(upload.json().skin.url, 'https://westronskin.example.test/api/v1/profiles/SkinOwner/skin.png');

  const publicProfile = await app.inject({ method: 'GET', url: '/api/v1/profiles/skinowner' });
  assert.equal(publicProfile.statusCode, 200);
  assert.equal(publicProfile.json().username, 'SkinOwner');
  assert.equal(publicProfile.headers['access-control-allow-origin'], '*');
  const pngResponse = await app.inject({ method: 'GET', url: '/api/v1/profiles/SkinOwner/skin.png' });
  assert.equal(pngResponse.statusCode, 200);
  assert.equal(pngResponse.headers['content-type'], 'image/png');
  assert.equal(pngResponse.headers['access-control-allow-origin'], '*');
  assert.deepEqual(pngResponse.rawPayload, firstPng);
  const cachedSkinResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/profiles/SkinOwner/skin.png',
    headers: { 'if-none-match': pngResponse.headers.etag },
  });
  assert.equal(cachedSkinResponse.statusCode, 304);
  assert.equal(cachedSkinResponse.headers['access-control-allow-origin'], '*');

  const secondPng = await createPng(64, 32);
  const replacement = multipartSkin(secondPng);
  replacement.headers.authorization = `Bearer ${login.json().accessToken}`;
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/me/skin', ...replacement })).statusCode, 200);
  const stored = app.skinDatabase.prepare('SELECT storage_key FROM skins').get();
  await readFile(path.join(dataDir, 'skins', stored.storage_key));
  assert.equal((await app.inject({
    method: 'DELETE',
    url: '/api/v1/me/skin',
    headers: bearer(login.json().accessToken),
  })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/profiles/SkinOwner/skin.png' })).statusCode, 404);
});

test('rejects malformed and oversized skin uploads and protects authenticated routes', async () => {
  const account = await createAccount('SkinChecks');
  const malformed = multipartSkin(Buffer.from('not a png'));
  malformed.headers.authorization = `Bearer ${account.accessToken}`;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...malformed })).statusCode, 415);

  const wrongDimensions = multipartSkin(await createPng(32, 32));
  wrongDimensions.headers.authorization = `Bearer ${account.accessToken}`;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...wrongDimensions })).statusCode, 422);

  const unsupportedMedia = multipartSkin(await createPng(), { contentType: 'application/octet-stream' });
  unsupportedMedia.headers.authorization = `Bearer ${account.accessToken}`;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...unsupportedMedia })).statusCode, 415);

  const unsupportedRequest = await app.inject({
    method: 'POST',
    url: '/api/v1/me/cape',
    headers: {
      ...bearer(account.accessToken),
      'content-type': 'text/plain',
    },
    payload: 'not multipart data',
  });
  assert.equal(unsupportedRequest.statusCode, 415, unsupportedRequest.body);
  assert.equal(unsupportedRequest.json().error.code, 'unsupported_media_type');

  const oversized = multipartSkin(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(1024 * 1024)]));
  oversized.headers.authorization = `Bearer ${account.accessToken}`;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...oversized })).statusCode, 413);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/profiles/UnknownPlayer' })).statusCode, 404);

  const largePng = await sharp(randomBytes(64 * 64 * 4), {
    raw: { width: 64, height: 64, channels: 4 },
  }).png().toBuffer();
  assert.ok(largePng.length > 16 * 1024);
  const largeRequest = multipartSkin(largePng);
  largeRequest.headers.authorization = `Bearer ${account.accessToken}`;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/skin', ...largeRequest })).statusCode, 201);
});

test('resend and reset requests do not reveal whether an address exists', async () => {
  const missingReset = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/request-password-reset',
    payload: { email: 'missing@example.test' },
  });
  assert.equal(missingReset.statusCode, 200);
  const missingResend = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    payload: { email: 'missing@example.test' },
  });
  assert.equal(missingResend.statusCode, 200);
});

test('resend-verification uses POST, hides account state, and only refreshes eligible tokens', async () => {
  const pending = await register('PendingUser', 'pending@example.test');
  const tokenHashBefore = app.skinDatabase.prepare('SELECT token_hash FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)').get('pending@example.test').token_hash;
  const resendPending = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    payload: { email: pending.email },
  });
  assert.equal(resendPending.statusCode, 200, resendPending.body);
  assert.equal(mailTokens.verification.length, 2);
  const tokenRow = app.skinDatabase.prepare(`
    SELECT t.token_hash, t.expires_at FROM email_verification_tokens t
    JOIN users u ON u.id = t.user_id WHERE u.email_normalized = ?
  `).get(pending.email);
  assert.notEqual(tokenRow.token_hash, tokenHashBefore);
  assert.ok(tokenRow.expires_at > Date.now());
  assert.ok(tokenRow.expires_at <= Date.now() + 31 * 60 * 1000);

  const resendMissing = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    payload: { email: 'unknown@example.test' },
  });
  assert.equal(resendMissing.statusCode, 200);
  assert.deepEqual(resendMissing.json(), resendPending.json());
  assert.equal(mailTokens.verification.length, 2);

  assert.equal((await verify(pending.email)).statusCode, 200);
  const resendVerified = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    payload: { email: pending.email },
  });
  assert.equal(resendVerified.statusCode, 200);
  assert.deepEqual(resendVerified.json(), resendPending.json());
  assert.equal(mailTokens.verification.length, 2);

  const invalidEmail = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    payload: { email: 'not-an-email' },
  });
  assert.equal(invalidEmail.statusCode, 400);
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/auth/resend-verification',
  })).statusCode, 404);
});

test('limits authentication attempts and restricts configured CORS origins', async () => {
  const limitedDir = path.join(dataDir, 'limited');
  const limitedApp = await buildApp({
    dataDir: limitedDir,
    logger: false,
    mailer: fakeMailer,
    env: {
      DATA_DIR: limitedDir,
      PUBLIC_BASE_URL: 'https://westronskin.example.test',
      RATE_LIMIT_MAX: '100',
      AUTH_RATE_LIMIT_MAX: '1',
      CORS_ORIGINS: 'https://client.example.test',
    },
  });
  try {
    const allowed = await limitedApp.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: {
        origin: 'https://client.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://client.example.test');
    const blocked = await limitedApp.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://untrusted.example.test', 'access-control-request-method': 'POST' },
    });
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);

    const payload = { email: 'nobody@example.test', password: 'correct horse battery staple' };
    assert.equal((await limitedApp.inject({ method: 'POST', url: '/api/v1/auth/login', payload })).statusCode, 401);
    const rateLimited = await limitedApp.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
    assert.equal(rateLimited.statusCode, 429);
    assert.equal(rateLimited.json().error.code, 'rate_limit_exceeded');
    const firstResend = await limitedApp.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      payload: { email: 'unknown@example.test' },
    });
    assert.equal(firstResend.statusCode, 200);
    const limitedResend = await limitedApp.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      payload: { email: 'unknown@example.test' },
    });
    assert.equal(limitedResend.statusCode, 429);
  } finally {
    await limitedApp.close();
  }
});

test('returns a safe temporary error when verification email delivery fails', async () => {
  const failingDir = path.join(dataDir, 'mailer-failure');
  const failingApp = await buildApp({
    dataDir: failingDir,
    logger: false,
    mailer: {
      async sendVerification() {
        throw Object.assign(new Error('private SMTP detail'), { code: 'ECONNECTION' });
      },
      async sendPasswordReset() {},
    },
    env: {
      DATA_DIR: failingDir,
      PUBLIC_BASE_URL: 'https://westronskin.example.test',
      RATE_LIMIT_MAX: '100',
      AUTH_RATE_LIMIT_MAX: '100',
    },
  });
  try {
    const response = await failingApp.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'MailFailure', email: 'mailfailure@example.test', password: 'correct horse battery staple' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'email_delivery_failed');
    assert.equal(response.body.includes('private SMTP detail'), false);
    assert.equal(failingApp.skinDatabase.prepare('SELECT COUNT(*) AS count FROM email_verification_tokens').get().count, 1);
  } finally {
    await failingApp.close();
  }
});

test('migrates legacy sessions and skins, then lets the owner claim email and upgrade scrypt', async () => {
  const legacyDir = path.join(dataDir, 'legacy');
  const databasePath = path.join(legacyDir, 'db', 'skin-api.sqlite');
  await mkdir(path.dirname(databasePath), { recursive: true });
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE skins (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE,
      model TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  const userId = 'legacy-user-id';
  const oldPassword = 'legacy horse battery staple';
  const salt = 'legacy-salt';
  const passwordHash = scryptSync(oldPassword, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex');
  const legacyToken = randomBytes(32).toString('base64url');
  const storageKey = `${userId}/legacy.png`;
  const skin = await createPng();
  legacyDb.prepare(`
    INSERT INTO users (id, username, username_normalized, password_hash, password_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, 'LegacyUser', 'legacyuser', passwordHash, salt, new Date().toISOString());
  legacyDb.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(legacyToken), userId, Date.now() + 60 * 60 * 1000, new Date().toISOString());
  legacyDb.prepare(`
    INSERT INTO skins (user_id, storage_key, model, sha256, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, storageKey, 'classic', createHash('sha256').update(skin).digest('hex'), new Date().toISOString());
  legacyDb.close();
  await mkdir(path.join(legacyDir, 'skins', userId), { recursive: true });
  await writeFile(path.join(legacyDir, 'skins', storageKey), skin);

  const legacyApp = await buildApp({
    dataDir: legacyDir,
    logger: false,
    mailer: fakeMailer,
    env: {
      DATA_DIR: legacyDir,
      PUBLIC_BASE_URL: 'https://westronskin.example.test',
      RATE_LIMIT_MAX: '1000',
      AUTH_RATE_LIMIT_MAX: '1000',
    },
  });
  try {
    const claimed = await legacyApp.inject({
      method: 'POST',
      url: '/api/v1/auth/claim-legacy-account',
      headers: bearer(legacyToken),
      payload: { email: 'legacy@example.test' },
    });
    assert.equal(claimed.statusCode, 200, claimed.body);
    const token = mailTokens.verification.at(-1);
    const verified = await legacyApp.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { email: 'legacy@example.test', token },
    });
    assert.equal(verified.statusCode, 200, verified.body);

    const login = await legacyApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'legacy@example.test', password: oldPassword },
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(legacyApp.skinDatabase.prepare('SELECT password_algorithm FROM users WHERE id = ?').get(userId).password_algorithm, 'argon2id');
    assert.equal(legacyApp.skinDatabase.prepare('SELECT COUNT(*) AS count FROM skins WHERE user_id = ?').get(userId).count, 1);
    assert.equal((await legacyApp.inject({ method: 'GET', url: '/api/v1/profiles/LegacyUser/skin.png' })).statusCode, 200);
  } finally {
    await legacyApp.close();
  }
});


test('cape upload, public profile and legacy texture compatibility flow', async () => {
  const account = await createAccount('CapePlayer');
  const capePng = await createPng(64, 32);
  const capeReq = multipartCape(capePng);
  capeReq.headers.authorization = `Bearer ${account.accessToken}`;
  const upload = await app.inject({
    method: 'POST',
    url: '/api/v1/me/cape',
    ...capeReq,
  });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().cape.url, 'https://westronskin.example.test/api/v1/profiles/CapePlayer/cape.png');

  const myProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: bearer(account.accessToken),
  });
  assert.equal(myProfile.statusCode, 200, myProfile.body);
  assert.equal(myProfile.json().cape.url, upload.json().cape.url);
  assert.equal(myProfile.json().elytra, null);

  const profile = await app.inject({ method: 'GET', url: '/api/v1/profiles/capeplayer' });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().cape.url, 'https://westronskin.example.test/api/v1/profiles/CapePlayer/cape.png');

  const capeFile = await app.inject({ method: 'GET', url: '/api/v1/profiles/CapePlayer/cape.png' });
  assert.equal(capeFile.statusCode, 200);
  assert.equal(capeFile.headers['access-control-allow-origin'], '*');
  assert.deepEqual(capeFile.rawPayload, capePng);

  const legacyTexture = await app.inject({ method: 'GET', url: '/skin/profile/texture/login/CapePlayer' });
  assert.equal(legacyTexture.statusCode, 200);
  assert.equal(legacyTexture.json().CAPE.url, 'https://westronskin.example.test/api/v1/profiles/CapePlayer/cape.png');

  const del = await app.inject({
    method: 'DELETE',
    url: '/api/v1/me/cape',
    headers: bearer(account.accessToken),
  });
  assert.equal(del.statusCode, 204);
});

test('elytra upload, replacement, public texture and removal flow', async () => {
  const account = await createAccount('ElytraPlayer');
  const elytraPng = await createPng(64, 32);
  const elytraReq = multipartElytra(elytraPng);
  elytraReq.headers.authorization = `Bearer ${account.accessToken}`;
  const upload = await app.inject({
    method: 'POST',
    url: '/api/v1/me/elytra',
    ...elytraReq,
  });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().elytra.url, 'https://westronskin.example.test/api/v1/profiles/ElytraPlayer/elytra.png');
  assert.equal(upload.json().cape, null);

  const myProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: bearer(account.accessToken),
  });
  assert.equal(myProfile.statusCode, 200, myProfile.body);
  assert.equal(myProfile.json().elytra.url, upload.json().elytra.url);

  const profile = await app.inject({ method: 'GET', url: '/api/v1/profiles/elytraplayer' });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().elytra.url, upload.json().elytra.url);

  const elytraFile = await app.inject({ method: 'GET', url: '/api/v1/profiles/ElytraPlayer/elytra.png' });
  assert.equal(elytraFile.statusCode, 200, elytraFile.body);
  assert.equal(elytraFile.headers['access-control-allow-origin'], '*');
  assert.deepEqual(elytraFile.rawPayload, elytraPng);

  const replacementReq = multipartElytra(elytraPng);
  replacementReq.headers.authorization = `Bearer ${account.accessToken}`;
  const replacement = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/elytra',
    ...replacementReq,
  });
  assert.equal(replacement.statusCode, 200, replacement.body);

  const del = await app.inject({
    method: 'DELETE',
    url: '/api/v1/me/elytra',
    headers: bearer(account.accessToken),
  });
  assert.equal(del.statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/profiles/ElytraPlayer/elytra.png' })).statusCode, 404);
  const deletedProfile = await app.inject({ method: 'GET', url: '/api/v1/profiles/ElytraPlayer' });
  assert.equal(deletedProfile.json().elytra, null);
});

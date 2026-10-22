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
      RATE_LIMIT_MAX: '1000',
      AUTH_RATE_LIMIT_MAX: '1000',
    },
  });
});

test('allows enough time for large release uploads to arrive through a slow connection', () => {
  assert.equal(app.server.requestTimeout, 90 * 60 * 1000);
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
  const resendOperation = document.paths['/api/v1/auth/resend-verification']?.post;
  assert.equal(resendOperation?.operationId, 'resendVerification');
  assert.ok(resendOperation.responses['503']);
  assert.equal(document.paths['/api/v1/auth/resend-verification']?.get, undefined);
  assert.equal(document.paths['/v1/auth/resend-verification'], undefined);
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
    ['POST /api/v1/me/skin', '/api/v1/me/skin'],
    ['PUT /api/v1/me/skin', '/api/v1/me/skin'],
    ['DELETE /api/v1/me/skin', '/api/v1/me/skin'],
    ['GET /api/v1/profiles/{username}', '/api/v1/profiles/:username'],
    ['GET /api/v1/profiles/{username}/skin.png', '/api/v1/profiles/:username/skin.png'],
    ['GET /updates/{filename}', '/updates/:filename'],
    ['POST /api/v1/admin/updates/{filename}', '/api/v1/admin/updates/:filename'],
  ]) {
    const [method] = route.split(' ');
    assert.ok(app.hasRoute({ method, url: pathName }), `Missing implementation for ${route}`);
    const [documentMethod, documentPath] = route.split(' ');
    assert.ok(document.paths[documentPath]?.[documentMethod.toLowerCase()], `Missing OpenAPI operation ${route}`);
  }
});

test('only the verified update publisher can upload a hash-matched release feed', async () => {
  const owner = await createAccount('ReleaseOwner', 'ermiscaner78@gmail.com');
  const otherAccount = await createAccount('RegularUpdater', 'regular@example.test');
  const installer = Buffer.from('test installer payload');
  const hash = createHash('sha512').update(installer).digest('base64');
  const filename = 'Westron Client Setup 1.0.exe';
  const manifest = Buffer.from([
    'version: 1.0.5',
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

test('password reset is one-time and revokes all existing sessions', async () => {
  const account = await createAccount('ResetUser');
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/request-password-reset',
    payload: { email: 'resetuser@example.test' },
  });
  assert.equal(request.statusCode, 200);
  const token = mailTokens.reset[0];
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
  const pngResponse = await app.inject({ method: 'GET', url: '/api/v1/profiles/SkinOwner/skin.png' });
  assert.equal(pngResponse.statusCode, 200);
  assert.equal(pngResponse.headers['content-type'], 'image/png');
  assert.deepEqual(pngResponse.rawPayload, firstPng);
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/v1/profiles/SkinOwner/skin.png',
    headers: { 'if-none-match': pngResponse.headers.etag },
  })).statusCode, 304);

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

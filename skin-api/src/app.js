import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createMailer } from './mailer.js';
import { migrateDatabase } from './database.js';
import { ApiError, sendError } from './errors.js';
import {
  createOpaqueToken,
  createId,
  hashPassword,
  hashToken,
  normalizeEmail,
  normalizeUsername,
  parseBearerToken,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './security.js';
import { MAX_SKIN_BYTES, persistSkin, removeSkinFile, validateSkinPng } from './skins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_UPDATE_BYTES = 256 * 1024 * 1024;
const UPDATE_UPLOAD_REQUEST_TIMEOUT_MS = 90 * 60 * 1000;
const UPDATE_PUBLISHER_EMAIL = 'ermiscaner78@gmail.com';
const SKIN_MODEL_SCHEMA = {
  type: 'string',
  enum: ['classic', 'slim'],
};
const claimLegacyBody = {
  type: 'object',
  additionalProperties: false,
  required: ['email'],
  properties: { email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' } },
};

const errorResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
};

function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseTrustProxy(value) {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  return value;
}

function profileResponse(user, skin, publicBaseUrl) {
  return {
    username: user.username,
    skin: skin ? {
      model: skin.model,
      url: `${publicBaseUrl}/api/v1/profiles/${encodeURIComponent(user.username)}/skin.png`,
      updatedAt: skin.updated_at,
    } : null,
  };
}

function validateVerificationToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{40,50}$/.test(token);
}

function validateCredentials(body) {
  if (!validateEmail(body?.email)) {
    throw new ApiError(400, 'invalid_email', 'Geçerli bir e-posta adresi girin.');
  }
  if (!validatePassword(body?.password)) {
    throw new ApiError(400, 'invalid_password', 'Parola en az 12 karakter ve en fazla 128 bayt olmalıdır.');
  }
}

function isUpdateAssetName(filename) {
  return filename === 'latest.yml'
    || /^Westron Client Setup (?:\d+\.\d+\.\d+|1\.0)\.exe(?:\.blockmap)?$/.test(filename);
}

function parseUpdateManifest(buffer) {
  const manifest = buffer.toString('utf8');
  const version = manifest.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const fileName = manifest.match(/^  - url:\s*(Westron Client Setup (?:\d+\.\d+\.\d+|1\.0)\.exe)\s*$/m)?.[1];
  const sha512 = manifest.match(/^    sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  const versionedFileName = version && fileName === `Westron Client Setup ${version}.exe`;
  const stableProductFileName = version?.startsWith('1.0.') && fileName === 'Westron Client Setup 1.0.exe';
  if (!version || !fileName || !sha512 || (!versionedFileName && !stableProductFileName)) {
    throw new ApiError(400, 'invalid_update_manifest', 'Güncelleme metadata dosyası geçersiz.');
  }
  return { version, fileName, sha512 };
}

export async function buildApp({
  env = process.env,
  dataDir = env.DATA_DIR || '/data',
  logger = true,
  mailer = createMailer(env),
} = {}) {
  const databasePath = env.DATABASE_PATH || path.join(dataDir, 'db', 'skin-api.sqlite');
  const skinsDir = path.resolve(env.SKINS_DIR || path.join(dataDir, 'skins'));
  const updatesDir = path.resolve(env.UPDATES_DIR || path.join(dataDir, 'updates'));
  const updatePublisherEmail = normalizeEmail(env.UPDATE_PUBLISHER_EMAIL || UPDATE_PUBLISHER_EMAIL);
  const publicUrl = new URL(env.PUBLIC_BASE_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password) {
    throw new Error('PUBLIC_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  const publicBaseUrl = publicUrl.origin + publicUrl.pathname.replace(/\/+$/, '');
  const accessTokenTtlSeconds = parsePositiveInteger(env.ACCESS_TOKEN_TTL_SECONDS, 900, 'ACCESS_TOKEN_TTL_SECONDS');
  const refreshTokenTtlDays = parsePositiveInteger(env.REFRESH_TOKEN_TTL_DAYS, 30, 'REFRESH_TOKEN_TTL_DAYS');
  const oneTimeTokenTtlMinutes = parsePositiveInteger(env.ONE_TIME_TOKEN_TTL_MINUTES, 30, 'ONE_TIME_TOKEN_TTL_MINUTES');
  if (refreshTokenTtlDays > 365) throw new Error('REFRESH_TOKEN_TTL_DAYS must not exceed 365');
  const rateLimitMax = parsePositiveInteger(env.RATE_LIMIT_MAX, 120, 'RATE_LIMIT_MAX');
  const authRateLimitMax = parsePositiveInteger(env.AUTH_RATE_LIMIT_MAX, 8, 'AUTH_RATE_LIMIT_MAX');
  const dummyPasswordHash = await argon2.hash(createId(), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });

  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  await mkdir(skinsDir, { recursive: true, mode: 0o700 });
  await mkdir(updatesDir, { recursive: true, mode: 0o700 });
  const database = new Database(databasePath);
  await chmod(databasePath, 0o600);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  await migrateDatabase(database);
  function cleanExpiredAuthData() {
    const now = Date.now();
    database.transaction(() => {
      database.prepare('DELETE FROM access_tokens WHERE expires_at <= ?').run(now);
      database.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?').run(now);
      database.prepare('DELETE FROM email_verification_tokens WHERE expires_at <= ?').run(now);
      database.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?').run(now);
      database.prepare('DELETE FROM sessions WHERE revoked_at IS NOT NULL OR refresh_expires_at <= ?').run(now);
    })();
  }
  cleanExpiredAuthData();

  const app = Fastify({
    logger: logger ? {
      level: env.LOG_LEVEL || 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.email',
        'req.body.token',
        'req.body.refreshToken',
      ],
    } : false,
    bodyLimit: 16 * 1024,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  });
  app.server.requestTimeout = UPDATE_UPLOAD_REQUEST_TIMEOUT_MS;

  app.decorate('skinDatabase', database);
  app.decorateRequest('skinUser', null);
  app.decorateRequest('skinSessionId', null);
  const authCleanupInterval = setInterval(() => {
    try {
      cleanExpiredAuthData();
    } catch (error) {
      app.log.error({ err: error }, 'Could not clean expired authentication data');
    }
  }, 60 * 60 * 1000);
  authCleanupInterval.unref();
  app.addHook('onClose', async () => {
    clearInterval(authCleanupInterval);
    database.close();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendError(reply, error.statusCode, error.code, error.message);
    }
    if (error.statusCode === 413 || error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return sendError(reply, 413, 'payload_too_large', 'İstek veya skin dosyası izin verilen boyutu aşıyor.');
    }
    if (error.statusCode === 429 || error.error?.code === 'rate_limit_exceeded') {
      return sendError(reply, 429, 'rate_limit_exceeded', 'Çok fazla istek gönderildi.');
    }
    if (error.validation || error.statusCode === 400) {
      return sendError(reply, 400, 'invalid_request', 'İstek biçimi veya alan değerleri geçersiz.');
    }
    request.log.error({ err: error }, 'Unhandled API error');
    return sendError(reply, 500, 'internal_error', 'Beklenmeyen bir sunucu hatası oluştu.');
  });

  const corsOrigins = (env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (corsOrigins.length > 0) {
    await app.register(cors, {
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Skin-Model'],
      maxAge: 600,
    });
  }
  const rateLimitErrorResponse = () => ({
    error: { code: 'rate_limit_exceeded', message: 'Çok fazla istek gönderildi.' },
  });
  await app.register(rateLimit, {
    global: true,
    max: rateLimitMax,
    timeWindow: env.RATE_LIMIT_WINDOW || '1 minute',
    errorResponseBuilder: rateLimitErrorResponse,
  });
  await app.register(multipart, {
    limits: { fileSize: MAX_SKIN_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 32 },
  });
  app.addContentTypeParser('application/vnd.westron.update', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  const getUserById = database.prepare(`
    SELECT id, username, username_normalized, email, email_verified
    FROM users WHERE id = ?
  `);

  async function authenticateWithPolicy(request, requireVerifiedEmail) {
    const token = parseBearerToken(request.headers.authorization);
    const session = database.prepare(`
      SELECT sessions.id AS session_id, sessions.user_id
      FROM access_tokens
      JOIN sessions ON sessions.id = access_tokens.session_id
      WHERE access_tokens.token_hash = ?
        AND access_tokens.expires_at > ?
        AND access_tokens.revoked_at IS NULL
        AND sessions.revoked_at IS NULL
    `).get(hashToken(token), Date.now());
    if (!session) throw new ApiError(401, 'invalid_token', 'Oturum geçersiz, süresi dolmuş veya iptal edilmiş.');
    const user = getUserById.get(session.user_id);
    if (!user) throw new ApiError(401, 'invalid_token', 'Oturum geçersiz veya iptal edilmiş.');
    if (requireVerifiedEmail && !user.email_verified) {
      throw new ApiError(403, 'email_not_verified', 'Skin özelliklerini kullanmadan önce e-posta adresinizi doğrulayın.');
    }
    request.skinUser = user;
    request.skinSessionId = session.session_id;
  }
  async function authenticate(request) {
    return authenticateWithPolicy(request, true);
  }
  async function authenticateLegacyAccount(request) {
    return authenticateWithPolicy(request, false);
  }

  const accessTokenResponse = {
    type: 'object',
    additionalProperties: false,
    required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn', 'refreshExpiresIn', 'account'],
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      tokenType: { type: 'string', const: 'Bearer' },
      expiresIn: { type: 'integer' },
      refreshExpiresIn: { type: 'integer' },
      account: {
        type: 'object',
        required: ['username', 'email', 'emailVerified'],
        properties: {
          username: { type: 'string' },
          email: { type: 'string' },
          emailVerified: { type: 'boolean' },
        },
      },
    },
  };
  const authRouteConfig = {
    rateLimit: {
      max: authRateLimitMax,
      timeWindow: env.AUTH_RATE_LIMIT_WINDOW || '15 minutes',
      errorResponseBuilder: rateLimitErrorResponse,
    },
  };
  const protectedRouteConfig = { preHandler: authenticate };
  const skinUploadRouteConfig = {
    ...protectedRouteConfig,
    bodyLimit: MAX_SKIN_BYTES + 64 * 1024,
  };
  const bearerHeader = {
    type: 'object',
    required: ['authorization'],
    properties: { authorization: { type: 'string', pattern: '^Bearer [A-Za-z0-9_-]{40,64}$' } },
  };
  const usernameParams = {
    type: 'object',
    required: ['username'],
    properties: { username: { type: 'string', pattern: '^[A-Za-z0-9_]{3,16}$' } },
  };
  const registerBody = {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'email', 'password'],
    properties: {
      username: { type: 'string', pattern: '^[A-Za-z0-9_]{3,16}$' },
      email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' },
      password: { type: 'string', minLength: 12, maxLength: 128 },
    },
  };
  const credentialsBody = {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' },
      password: { type: 'string', minLength: 12, maxLength: 128 },
    },
  };
  const verificationBody = {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'token'],
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' },
      token: { type: 'string', minLength: 40, maxLength: 50 },
    },
  };
  const requestEmailBody = {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: { email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' } },
  };
  const resetPasswordBody = {
    ...verificationBody,
    required: ['email', 'token', 'newPassword'],
    properties: {
      ...verificationBody.properties,
      newPassword: { type: 'string', minLength: 12, maxLength: 128 },
    },
  };
  const refreshBody = {
    type: 'object',
    additionalProperties: false,
    required: ['refreshToken'],
    properties: { refreshToken: { type: 'string', minLength: 40, maxLength: 50 } },
  };
  const skinModelHeader = {
    type: 'object',
    properties: { 'x-skin-model': SKIN_MODEL_SCHEMA },
  };
  const skinHeaders = {
    type: 'object',
    properties: skinModelHeader.properties,
  };

  app.addSchema({
    $id: 'profile',
    type: 'object',
    additionalProperties: false,
    required: ['username', 'skin'],
    properties: {
      username: { type: 'string' },
      skin: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['model', 'url', 'updatedAt'],
            properties: {
              model: SKIN_MODEL_SCHEMA,
              url: { type: 'string', format: 'uri' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
    },
  });

  function createSession(user) {
    const sessionId = createId();
    const access = createOpaqueToken();
    const refresh = createOpaqueToken();
    const now = new Date().toISOString();
    const accessExpiresAt = Date.now() + accessTokenTtlSeconds * 1000;
    const refreshExpiresAt = Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    database.transaction(() => {
      database.prepare(`
        INSERT INTO sessions (id, user_id, created_at, refresh_expires_at)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, user.id, now, refreshExpiresAt);
      database.prepare('INSERT INTO access_tokens (token_hash, session_id, expires_at) VALUES (?, ?, ?)')
        .run(access.tokenHash, sessionId, accessExpiresAt);
      database.prepare(`
        INSERT INTO refresh_tokens (token_hash, session_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(refresh.tokenHash, sessionId, refreshExpiresAt, now);
    })();
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: accessTokenTtlSeconds,
      refreshExpiresIn: refreshTokenTtlDays * 24 * 60 * 60,
      account: {
        username: user.username,
        email: user.email,
        emailVerified: Boolean(user.email_verified),
      },
    };
  }

  function issueOneTimeToken(tableName, userId) {
    const { token, tokenHash } = createOpaqueToken();
    const expiresAt = Date.now() + oneTimeTokenTtlMinutes * 60 * 1000;
    const now = new Date().toISOString();
    database.transaction(() => {
      database.prepare(`DELETE FROM ${tableName} WHERE user_id = ?`).run(userId);
      database.prepare(`
        INSERT INTO ${tableName} (token_hash, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(tokenHash, userId, expiresAt, now);
    })();
    return token;
  }

  async function sendVerification(user, request) {
    const token = issueOneTimeToken('email_verification_tokens', user.id);
    try {
      await mailer.sendVerification(user.email, user.username, token);
    } catch (error) {
      request.log.warn({ code: error.code || 'SMTP_DELIVERY_FAILED' }, 'Verification email delivery failed');
      throw new ApiError(503, 'email_delivery_failed', 'E-posta gönderilemedi. Daha sonra yeniden deneyin.');
    }
  }

  async function sendPasswordReset(user, request) {
    const token = issueOneTimeToken('password_reset_tokens', user.id);
    try {
      await mailer.sendPasswordReset(user.email, user.username, token);
    } catch (error) {
      request.log.warn({ code: error.code || 'SMTP_DELIVERY_FAILED' }, 'Password reset email delivery failed');
      throw new ApiError(503, 'email_delivery_failed', 'E-posta gönderilemedi. Daha sonra yeniden deneyin.');
    }
  }

  app.get('/api/health', {
    schema: {
      operationId: 'healthCheck',
      tags: ['system'],
      response: {
        200: { type: 'object', required: ['status'], properties: { status: { const: 'ok' } } },
        500: errorResponse,
      },
    },
  }, async (_request, reply) => {
    database.prepare('SELECT 1').get();
    return reply.send({ status: 'ok' });
  });

  app.get('/updates/:filename', {
    schema: {
      operationId: 'downloadUpdateAsset',
      tags: ['updates'],
      params: {
        type: 'object',
        required: ['filename'],
        properties: { filename: { type: 'string', maxLength: 160 } },
      },
    },
  }, async (request, reply) => {
    const { filename } = request.params;
    if (!isUpdateAssetName(filename)) throw new ApiError(404, 'update_not_found', 'Güncelleme dosyası bulunamadı.');
    let contents;
    try {
      contents = await readFile(path.join(updatesDir, filename));
    } catch (error) {
      if (error.code === 'ENOENT') throw new ApiError(404, 'update_not_found', 'Güncelleme dosyası bulunamadı.');
      throw error;
    }
    reply.header('Cache-Control', filename === 'latest.yml' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable');
    if (filename.endsWith('.yml')) return reply.type('text/yaml; charset=utf-8').send(contents);
    if (filename.endsWith('.exe')) return reply.type('application/vnd.microsoft.portable-executable').send(contents);
    return reply.type('application/octet-stream').send(contents);
  });

  app.post('/api/v1/admin/updates/:filename', {
    ...protectedRouteConfig,
    bodyLimit: MAX_UPDATE_BYTES,
    schema: {
      operationId: 'publishUpdateAsset',
      tags: ['updates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['filename'],
        properties: { filename: { type: 'string', maxLength: 160 } },
      },
      response: {
        200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        413: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    if (normalizeEmail(request.skinUser.email || '') !== updatePublisherEmail) {
      throw new ApiError(403, 'update_publish_forbidden', 'Bu hesap güncelleme yayımlama yetkisine sahip değil.');
    }
    const { filename } = request.params;
    if (!isUpdateAssetName(filename)) throw new ApiError(400, 'invalid_update_filename', 'Güncelleme dosya adı geçersiz.');
    if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > MAX_UPDATE_BYTES) {
      throw new ApiError(400, 'invalid_update_asset', 'Güncelleme dosyası boş veya izin verilen boyutu aşıyor.');
    }

    if (filename === 'latest.yml') {
      const { fileName, sha512 } = parseUpdateManifest(request.body);
      let installer;
      let blockmap;
      try {
        [installer, blockmap] = await Promise.all([
          readFile(path.join(updatesDir, fileName)),
          readFile(path.join(updatesDir, `${fileName}.blockmap`)),
        ]);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new ApiError(400, 'update_assets_missing', 'Önce eşleşen kurulum ve blockmap dosyalarını yükleyin.');
        }
        throw error;
      }
      const actualHash = createHash('sha512').update(installer).digest('base64');
      if (actualHash !== sha512 || blockmap.length === 0) {
        throw new ApiError(400, 'update_assets_mismatch', 'Güncelleme metadata dosyası kurulum dosyalarıyla eşleşmiyor.');
      }
    }

    const targetPath = path.join(updatesDir, filename);
    const temporaryPath = path.join(updatesDir, `.${filename}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, request.body, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    return reply.send({ message: 'Güncelleme dosyası yayımlandı.' });
  });

  app.post('/api/v1/auth/register', {
    config: authRouteConfig,
    schema: {
      operationId: 'register',
      tags: ['authentication'],
      body: registerBody,
      response: { 201: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, 400: errorResponse, 409: errorResponse, 429: errorResponse, 500: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const { username, email, password } = request.body;
    if (!validateUsername(username)) throw new ApiError(400, 'invalid_username', 'Kullanıcı adı 3-16 karakter olmalı; harf, rakam ve alt çizgi kullanılabilir.');
    validateCredentials({ email, password });
    const emailNormalized = normalizeEmail(email);
    const existing = database.prepare(`
      SELECT username_normalized, email_normalized FROM users
      WHERE username_normalized = ? OR email_normalized = ?
    `).get(normalizeUsername(username), emailNormalized);
    if (existing) {
      const code = existing.username_normalized === normalizeUsername(username) ? 'username_taken' : 'email_taken';
      throw new ApiError(409, code, code === 'username_taken' ? 'Bu kullanıcı adı kullanımda.' : 'Bu e-posta adresi kullanımda.');
    }
    const credentials = await hashPassword(password);
    const userId = createId();
    const now = new Date().toISOString();
    try {
      database.prepare(`
        INSERT INTO users (id, username, username_normalized, email, email_normalized, password_hash, password_salt, password_algorithm, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, username, normalizeUsername(username), email.trim(), emailNormalized, credentials.hash, credentials.salt, credentials.algorithm, now);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409, 'account_exists', 'Bu kullanıcı adı veya e-posta adresi kullanımda.');
      throw error;
    }
    await sendVerification({ id: userId, username, email: email.trim() }, request);
    return reply.code(201).send({ message: 'Hesap oluşturuldu. Skin özelliklerini kullanmak için e-posta adresinizi doğrulayın.' });
  });

  app.post('/api/v1/auth/verify-email', {
    config: authRouteConfig,
    schema: {
      operationId: 'verifyEmail',
      tags: ['authentication'],
      body: verificationBody,
      response: { 200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, 400: errorResponse, 404: errorResponse, 429: errorResponse },
    },
  }, async (request, reply) => {
    const { email, token } = request.body;
    if (!validateEmail(email) || !validateVerificationToken(token)) throw new ApiError(400, 'invalid_verification', 'Doğrulama bilgileri geçersiz.');
    const user = database.prepare(`
      SELECT users.id FROM users
      JOIN email_verification_tokens t ON t.user_id = users.id
      WHERE users.email_normalized = ? AND t.token_hash = ? AND t.expires_at > ?
    `).get(normalizeEmail(email), hashToken(token), Date.now());
    if (!user) throw new ApiError(404, 'invalid_or_expired_token', 'Doğrulama kodu geçersiz veya süresi dolmuş.');
    database.transaction(() => {
      database.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
      database.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(user.id);
    })();
    return reply.send({ message: 'E-posta adresi doğrulandı. Giriş yapabilirsiniz.' });
  });

  app.post('/api/v1/auth/resend-verification', {
    config: authRouteConfig,
    schema: {
      operationId: 'resendVerification',
      tags: ['authentication'],
      body: requestEmailBody,
      response: { 200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, 400: errorResponse, 429: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const { email } = request.body;
    if (!validateEmail(email)) throw new ApiError(400, 'invalid_email', 'Geçerli bir e-posta adresi girin.');
    const user = database.prepare('SELECT id, username, email, email_verified FROM users WHERE email_normalized = ?')
      .get(normalizeEmail(email));
    if (user && !user.email_verified) await sendVerification(user, request);
    return reply.send({ message: 'Adres kayıtlı ve doğrulanmamışsa yeni bir doğrulama e-postası gönderildi.' });
  });

  app.post('/api/v1/auth/claim-legacy-account', {
    config: authRouteConfig,
    preHandler: authenticateLegacyAccount,
    schema: {
      operationId: 'claimLegacyAccount',
      tags: ['authentication'],
      body: claimLegacyBody,
      response: {
        200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
        429: errorResponse,
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    const { email } = request.body;
    if (!validateEmail(email)) throw new ApiError(400, 'invalid_email', 'Geçerli bir e-posta adresi girin.');
    const legacyUser = database.prepare('SELECT email, email_verified FROM users WHERE id = ?')
      .get(request.skinUser.id);
    if (legacyUser.email || legacyUser.email_verified) {
      throw new ApiError(403, 'legacy_claim_not_available', 'Bu hesap için e-posta taşıma işlemi kullanılamaz.');
    }
    const emailNormalized = normalizeEmail(email);
    if (database.prepare('SELECT 1 FROM users WHERE email_normalized = ?').get(emailNormalized)) {
      throw new ApiError(409, 'email_taken', 'Bu e-posta adresi kullanımda.');
    }
    try {
      database.prepare('UPDATE users SET email = ?, email_normalized = ? WHERE id = ?')
        .run(email.trim(), emailNormalized, request.skinUser.id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409, 'email_taken', 'Bu e-posta adresi kullanımda.');
      throw error;
    }
    await sendVerification({
      id: request.skinUser.id,
      username: request.skinUser.username,
      email: email.trim(),
    }, request);
    return reply.send({ message: 'Hesap e-postası eklendi. Skin özelliklerini kullanmak için doğrulama kodunu girin.' });
  });

  app.post('/api/v1/auth/login', {
    config: authRouteConfig,
    schema: {
      operationId: 'login',
      tags: ['authentication'],
      body: credentialsBody,
      response: { 200: accessTokenResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 429: errorResponse },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;
    if (!validateEmail(email) || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 128) {
      throw new ApiError(401, 'invalid_credentials', 'E-posta veya parola hatalı.');
    }
    const user = database.prepare(`
      SELECT id, username, email, email_verified, password_hash, password_salt, password_algorithm
      FROM users WHERE email_normalized = ?
    `).get(normalizeEmail(email));
    const credentials = user
      ? { algorithm: user.password_algorithm, salt: user.password_salt, hash: user.password_hash }
      : { algorithm: 'argon2id', salt: '', hash: dummyPasswordHash };
    const valid = await verifyPassword(password, credentials);
    if (!user || !valid) throw new ApiError(401, 'invalid_credentials', 'E-posta veya parola hatalı.');
    if (!user.email_verified) throw new ApiError(403, 'email_not_verified', 'Giriş yapmadan önce e-posta adresinizi doğrulayın.');
    if (user.password_algorithm !== 'argon2id') {
      const upgraded = await hashPassword(password);
      database.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_algorithm = ? WHERE id = ?')
        .run(upgraded.hash, upgraded.salt, upgraded.algorithm, user.id);
    }
    return reply.send(createSession(user));
  });

  app.post('/api/v1/auth/refresh', {
    config: authRouteConfig,
    schema: {
      operationId: 'refreshSession',
      tags: ['authentication'],
      body: refreshBody,
      response: { 200: accessTokenResponse, 400: errorResponse, 401: errorResponse, 429: errorResponse },
    },
  }, async (request, reply) => {
    const oldHash = hashToken(request.body.refreshToken);
    const nowMs = Date.now();
    const row = database.prepare(`
      SELECT r.session_id, r.expires_at, r.used_at, s.user_id, s.revoked_at,
        u.username, u.email, u.email_verified
      FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id
      JOIN users u ON u.id = s.user_id WHERE r.token_hash = ?
    `).get(oldHash);
    if (!row) throw new ApiError(401, 'invalid_refresh_token', 'Yenileme belirteci geçersiz veya süresi dolmuş.');
    if (row.used_at) {
      database.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), row.session_id);
      throw new ApiError(401, 'refresh_token_reuse', 'Yenileme belirteci yeniden kullanılmış; oturum iptal edildi.');
    }
    if (row.expires_at <= nowMs || row.revoked_at || !row.email_verified) {
      throw new ApiError(401, 'invalid_refresh_token', 'Yenileme belirteci geçersiz veya süresi dolmuş.');
    }
    const access = createOpaqueToken();
    const refresh = createOpaqueToken();
    const accessExpires = nowMs + accessTokenTtlSeconds * 1000;
    const refreshExpires = nowMs + refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    database.transaction(() => {
      const result = database.prepare('UPDATE refresh_tokens SET used_at = ?, replaced_by_hash = ? WHERE token_hash = ? AND used_at IS NULL')
        .run(new Date().toISOString(), refresh.tokenHash, oldHash);
      if (result.changes !== 1) throw new ApiError(401, 'refresh_token_reuse', 'Yenileme belirteci yeniden kullanılmış.');
      database.prepare('INSERT INTO access_tokens (token_hash, session_id, expires_at) VALUES (?, ?, ?)')
        .run(access.tokenHash, row.session_id, accessExpires);
      database.prepare('INSERT INTO refresh_tokens (token_hash, session_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(refresh.tokenHash, row.session_id, refreshExpires, new Date().toISOString());
      database.prepare('UPDATE sessions SET refresh_expires_at = ?, last_used_at = ? WHERE id = ?')
        .run(refreshExpires, new Date().toISOString(), row.session_id);
    })();
    return reply.send({
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: accessTokenTtlSeconds,
      refreshExpiresIn: refreshTokenTtlDays * 86400,
      account: { username: row.username, email: row.email, emailVerified: Boolean(row.email_verified) },
    });
  });

  app.post('/api/v1/auth/request-password-reset', {
    config: authRouteConfig,
    schema: {
      operationId: 'requestPasswordReset',
      tags: ['authentication'],
      body: requestEmailBody,
      response: { 200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, 400: errorResponse, 429: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const { email } = request.body;
    if (!validateEmail(email)) throw new ApiError(400, 'invalid_email', 'Geçerli bir e-posta adresi girin.');
    const user = database.prepare('SELECT id, username, email, email_verified FROM users WHERE email_normalized = ?')
      .get(normalizeEmail(email));
    if (user && user.email_verified) await sendPasswordReset(user, request);
    return reply.send({ message: 'Adres kayıtlı ve doğrulanmışsa parola sıfırlama e-postası gönderildi.' });
  });

  app.post('/api/v1/auth/reset-password', {
    config: authRouteConfig,
    schema: {
      operationId: 'resetPassword',
      tags: ['authentication'],
      body: resetPasswordBody,
      response: { 200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, 400: errorResponse, 404: errorResponse, 429: errorResponse },
    },
  }, async (request, reply) => {
    const { email, token, newPassword } = request.body;
    if (!validateEmail(email) || !validateVerificationToken(token) || !validatePassword(newPassword)) {
      throw new ApiError(400, 'invalid_reset', 'Parola sıfırlama bilgileri geçersiz.');
    }
    const user = database.prepare(`
      SELECT users.id FROM users JOIN password_reset_tokens t ON t.user_id = users.id
      WHERE users.email_normalized = ? AND t.token_hash = ? AND t.expires_at > ?
    `).get(normalizeEmail(email), hashToken(token), Date.now());
    if (!user) throw new ApiError(404, 'invalid_or_expired_token', 'Sıfırlama kodu geçersiz veya süresi dolmuş.');
    const credentials = await hashPassword(newPassword);
    const consumed = database.transaction(() => {
      const result = database.prepare(`
        DELETE FROM password_reset_tokens
        WHERE user_id = ? AND token_hash = ? AND expires_at > ?
      `).run(user.id, hashToken(token), Date.now());
      if (result.changes !== 1) return false;
      database.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_algorithm = ? WHERE id = ?')
        .run(credentials.hash, credentials.salt, credentials.algorithm, user.id);
      database.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), user.id);
      return true;
    })();
    if (!consumed) throw new ApiError(404, 'invalid_or_expired_token', 'Sıfırlama kodu geçersiz veya süresi dolmuş.');
    return reply.send({ message: 'Parola güncellendi. Tüm oturumlar kapatıldı.' });
  });

  app.post('/api/v1/auth/logout', {
    config: authRouteConfig,
    preHandler: authenticateLegacyAccount,
    schema: {
      operationId: 'logout',
      tags: ['authentication'],
      response: { 204: { type: 'null' }, 401: errorResponse, 429: errorResponse },
    },
  }, async (request, reply) => {
    database.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), request.skinSessionId);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'getMyProfile',
      tags: ['profiles'],
      response: { 200: { $ref: 'profile#' }, 401: errorResponse, 403: errorResponse, 429: errorResponse, 500: errorResponse },
    },
  }, async (request) => {
    const skin = database.prepare('SELECT model, updated_at FROM skins WHERE user_id = ?')
      .get(request.skinUser.id);
    return profileResponse(request.skinUser, skin, publicBaseUrl);
  });

  app.post('/api/v1/me/skin', {
    ...skinUploadRouteConfig,
    schema: {
      operationId: 'uploadSkin',
      tags: ['skins'],
      headers: skinHeaders,
      response: {
        201: { $ref: 'profile#' },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
        413: errorResponse,
        415: errorResponse,
        422: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => saveSkin(request, reply, { replace: false }));

  app.put('/api/v1/me/skin', {
    ...skinUploadRouteConfig,
    schema: {
      operationId: 'changeSkin',
      tags: ['skins'],
      headers: skinHeaders,
      response: {
        200: { $ref: 'profile#' },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        413: errorResponse,
        415: errorResponse,
        422: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => saveSkin(request, reply, { replace: true }));

  async function saveSkin(request, reply, { replace }) {
    const existing = database.prepare('SELECT storage_key FROM skins WHERE user_id = ?').get(request.skinUser.id);
    if (replace && !existing) throw new ApiError(404, 'skin_not_found', 'Değiştirilecek bir skin bulunamadı.');
    if (!replace && existing) throw new ApiError(409, 'skin_exists', 'Skin zaten mevcut; değiştirmek için PUT kullanın.');

    const part = await request.file();
    if (!part) throw new ApiError(400, 'skin_required', 'skin alanında bir PNG dosyası gönderin.');
    if (part.fieldname !== 'skin' || part.mimetype !== 'image/png') {
      part.file.resume();
      throw new ApiError(415, 'invalid_skin_format', 'Dosya image/png türünde ve skin alanında olmalıdır.');
    }
    const buffer = await part.toBuffer();
    if (part.file.truncated) throw new ApiError(413, 'invalid_skin_size', 'Skin PNG dosyası 1 MiB sınırını aşıyor.');
    const image = await validateSkinPng(buffer);
    const model = request.headers['x-skin-model'] || 'classic';
    const skin = await persistSkin({
      userId: request.skinUser.id,
      model,
      image,
      skinsDir,
      database,
      logger: request.log,
      replace,
    });
    const response = profileResponse(request.skinUser, skin, publicBaseUrl);
    return reply.code(replace ? 200 : 201).send(response);
  }

  app.delete('/api/v1/me/skin', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'deleteMySkin',
      tags: ['skins'],
      response: {
        204: { type: 'null' },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    const skin = database.prepare('SELECT storage_key FROM skins WHERE user_id = ?').get(request.skinUser.id);
    if (!skin) throw new ApiError(404, 'skin_not_found', 'Kaldırılacak bir skin bulunamadı.');
    database.prepare('DELETE FROM skins WHERE user_id = ?').run(request.skinUser.id);
    await removeSkinFile(skinsDir, skin.storage_key, request.log);
    return reply.code(204).send();
  });

  app.get('/api/v1/profiles/:username', {
    schema: {
      operationId: 'getPlayerProfile',
      tags: ['profiles'],
      params: usernameParams,
      response: {
        200: { $ref: 'profile#' },
        400: errorResponse,
        404: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request) => {
    const user = database.prepare('SELECT id, username FROM users WHERE username_normalized = ?')
      .get(normalizeUsername(request.params.username));
    if (!user) throw new ApiError(404, 'profile_not_found', 'Oyuncu profili bulunamadı.');
    const skin = database.prepare('SELECT model, updated_at FROM skins WHERE user_id = ?').get(user.id);
    return profileResponse(user, skin, publicBaseUrl);
  });

  app.get('/api/v1/profiles/:username/skin.png', {
    schema: {
      operationId: 'getPlayerSkin',
      tags: ['skins'],
      params: usernameParams,
      response: {
        200: { type: 'string', format: 'binary', 'content-type': 'image/png' },
        304: { type: 'null' },
        400: errorResponse,
        404: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    const skin = database.prepare(`
      SELECT skins.storage_key, skins.sha256 FROM skins
      JOIN users ON users.id = skins.user_id
      WHERE users.username_normalized = ?
    `).get(normalizeUsername(request.params.username));
    if (!skin) throw new ApiError(404, 'skin_not_found', 'Oyuncunun yüklenmiş bir skini yok.');
    const etag = `"${skin.sha256}"`;
    reply.header('Cache-Control', 'public, max-age=60, must-revalidate');
    reply.header('ETag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    const image = await readFile(path.join(skinsDir, skin.storage_key));
    return reply.type('image/png').send(image);
  });

  app.get('/api/openapi.yaml', {
    schema: {
      operationId: 'getOpenApiDocument',
      tags: ['system'],
      response: { 200: { type: 'string' }, 429: errorResponse, 500: errorResponse },
    },
  }, async (_request, reply) => reply.type('application/yaml; charset=utf-8').send(
    await readFile(path.join(ROOT, 'openapi.yaml'), 'utf8'),
  ));

  return app;
}

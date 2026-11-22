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
import sharp from 'sharp';
import { createMailer } from './mailer.js';
import { migrateDatabase } from './database.js';
import { ApiError, sendError } from './errors.js';
import {
  createOpaqueToken,
  createVerificationCode,
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
import {
  MAX_SKIN_BYTES,
  persistSkin,
  persistCape,
  persistElytra,
  removeSkinFile,
  validateSkinPng,
  validateCapePng,
  validateElytraPng,
} from './skins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_UPDATE_BYTES = 256 * 1024 * 1024;
const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROCESSED_PHOTO_BYTES = 5 * 1024 * 1024;
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
  const parsed = Number(value || fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseTrustProxy(value) {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  return value;
}

async function normalizeUploadedPhoto(photoBuffer) {
  if (!photoBuffer || photoBuffer.length === 0) {
    throw new ApiError(400, 'empty_photo', 'Fotoğraf dosyası boş olamaz.');
  }
  if (photoBuffer.length > MAX_PHOTO_UPLOAD_BYTES) {
    throw new ApiError(413, 'photo_too_large', 'Fotoğraf 10 MiB sınırını aşamaz.');
  }
  let png;
  try {
    let maxDimension = 1600;
    while (true) {
      png = await sharp(photoBuffer, { failOn: 'error' }).rotate().resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      if (png.length <= MAX_PROCESSED_PHOTO_BYTES || maxDimension === 320) break;
      maxDimension = Math.max(320, Math.floor(maxDimension * 0.8));
    }
  } catch {
    throw new ApiError(400, 'invalid_photo', 'Yüklenen dosya geçerli bir fotoğraf değil.');
  }
  if (png.length > MAX_PROCESSED_PHOTO_BYTES) {
    throw new ApiError(413, 'photo_too_large', 'Fotoğraf işlendikten sonra 5 MiB sınırını aşamaz.');
  }
  return png;
}

function configureIceServers(env) {
  const stunUrls = (env.STUN_SERVER_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const turnUrls = (env.TURN_SERVER_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
  const turnUsername = env.TURN_SERVER_USERNAME || '';
  const turnCredential = env.TURN_SERVER_CREDENTIAL || '';

  if ((turnUrls.length || turnUsername || turnCredential)
    && (!turnUrls.length || !turnUsername || !turnCredential)) {
    throw new Error('TURN_SERVER_URLS, TURN_SERVER_USERNAME and TURN_SERVER_CREDENTIAL must be configured together');
  }
  if ([...stunUrls, ...turnUrls].some((url) => !/^(?:stun|stuns|turn|turns):/i.test(url))) {
    throw new Error('STUN/TURN server URLs must use stun:, stuns:, turn: or turns: schemes');
  }

  const iceServers = stunUrls.length ? [{ urls: stunUrls }] : [];
  if (turnUrls.length) iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
  return iceServers;
}

function profileResponse(user, skin, publicBaseUrl, cape, elytra) {
  return {
    username: user.username,
    skin: skin ? {
      model: skin.model,
      url: `${publicBaseUrl}/api/v1/profiles/${encodeURIComponent(user.username)}/skin.png`,
      updatedAt: skin.updated_at,
    } : null,
    cape: cape ? {
      url: `${publicBaseUrl}/api/v1/profiles/${encodeURIComponent(user.username)}/cape.png`,
      updatedAt: cape.updated_at,
    } : null,
    elytra: elytra ? {
      url: `${publicBaseUrl}/api/v1/profiles/${encodeURIComponent(user.username)}/elytra.png`,
      updatedAt: elytra.updated_at,
    } : null,
  };
}

function validateVerificationToken(token) {
  return typeof token === 'string' && /^(?:\d{6}|[A-Za-z0-9_-]{40,50})$/.test(token);
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
    || /^(?:Westron-Launcher-Setup-|Westron-Client-Setup-|Westron Client Setup )(?:\d+\.\d+\.\d+|1\.0)\.exe(?:\.blockmap)?$/.test(filename);
}

function parseUpdateManifest(buffer) {
  const manifest = buffer.toString('utf8');
  const version = manifest.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const fileNameMatch = manifest.match(/^  - url:\s*((?:Westron-Launcher-Setup-|Westron-Client-Setup-|Westron Client Setup )(\d+\.\d+\.\d+|1\.0)\.exe)\s*$/m);
  const fileName = fileNameMatch?.[1];
  const fileVersion = fileNameMatch?.[2];
  const sha512 = manifest.match(/^    sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  if (!version || !fileName || fileVersion !== version || !sha512) {
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
  const photosDir = path.resolve(env.PHOTOS_DIR || path.join(dataDir, 'photos'));
  const updatesDir = path.resolve(env.UPDATES_DIR || path.join(dataDir, 'updates'));
  const updatePublisherEmail = UPDATE_PUBLISHER_EMAIL;
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
  const iceServers = configureIceServers(env);
  const dummyPasswordHash = await argon2.hash(createId(), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });

  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  await mkdir(skinsDir, { recursive: true, mode: 0o700 });
  await mkdir(photosDir, { recursive: true, mode: 0o700 });
  await mkdir(updatesDir, { recursive: true, mode: 0o700 });
  const database = new Database(databasePath);
  await chmod(databasePath, 0o600);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  await migrateDatabase(database);
  let photoCleanupPromise = null;
  async function cleanExpiredMessages() {
    if (photoCleanupPromise) return photoCleanupPromise;
    photoCleanupPromise = (async () => {
      const now = Date.now();
      const photoCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      const expiredDirectPhotos = database.prepare(`
        SELECT id, photo_url AS photoUrl
        FROM ephemeral_messages
        WHERE kind = 'photo' AND expires_at <= ?
      `).all(now);
      const expiredGroupPhotos = database.prepare(`
        SELECT id, photo_file_name AS photoFileName
        FROM friend_group_messages
        WHERE kind = 'photo' AND created_at <= ?
      `).all(photoCutoff);
      for (const message of expiredDirectPhotos) {
        const fileName = path.basename(new URL(message.photoUrl).pathname);
        await rm(path.join(photosDir, fileName), { force: true });
      }
      for (const message of expiredGroupPhotos) {
        if (/^[0-9a-f-]{36}\.png$/i.test(message.photoFileName ?? '')) {
          await rm(path.join(photosDir, message.photoFileName), { force: true });
        }
      }
      database.transaction(() => {
        database.prepare('DELETE FROM ephemeral_messages WHERE expires_at <= ?').run(now);
        database.prepare(`
          DELETE FROM friend_group_messages
          WHERE kind = 'photo' AND created_at <= ?
        `).run(photoCutoff);
      })();
    })();
    try {
      await photoCleanupPromise;
    } finally {
      photoCleanupPromise = null;
    }
  }
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
  await cleanExpiredMessages();

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
      void cleanExpiredMessages().catch((error) =>
        app.log.error({ err: error }, 'Could not clean expired photo messages'));
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
    if (error.statusCode === 415
      || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
      || (error.statusCode === 406 && error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE')) {
      return sendError(reply, 415, 'unsupported_media_type', 'Dosya yüklemesi multipart/form-data biçiminde olmalıdır.');
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
    limits: { fileSize: MAX_SKIN_BYTES, files: 1, fields: 1, parts: 2, fieldNameSize: 32 },
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
    const nowMs = Date.now();
    const session = database.prepare(`
      SELECT sessions.id AS session_id, sessions.user_id
      FROM access_tokens
      JOIN sessions ON sessions.id = access_tokens.session_id
      WHERE access_tokens.token_hash = ?
        AND access_tokens.expires_at > ?
        AND access_tokens.revoked_at IS NULL
        AND sessions.revoked_at IS NULL
        AND sessions.refresh_expires_at > ?
    `).get(hashToken(token), nowMs, nowMs);
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
  const friendshipExists = (firstUserId, secondUserId) => {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    return Boolean(database.prepare(`
      SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ?
    `).get(userLowId, userHighId));
  };
  const insertFriendship = database.prepare(`
    INSERT OR IGNORE INTO friendships (user_low_id, user_high_id, created_at)
    VALUES (?, ?, ?)
  `);
  const createFriendship = (firstUserId, secondUserId, createdAt = new Date().toISOString()) => {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    insertFriendship.run(userLowId, userHighId, createdAt);
  };

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
  const minecraftProfileBody = {
    type: 'object',
    additionalProperties: false,
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
      token: { type: 'string', minLength: 6, maxLength: 50 },
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
    required: ['username', 'skin', 'cape', 'elytra'],
    properties: {
      username: { type: 'string' },
      cape: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'updatedAt'],
            properties: {
              url: { type: 'string', format: 'uri' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      elytra: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'updatedAt'],
            properties: {
              url: { type: 'string', format: 'uri' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
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
    const { token, tokenHash } = tableName === 'email_verification_tokens' || tableName === 'password_reset_tokens'
      ? createVerificationCode()
      : createOpaqueToken();
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
      SELECT username_normalized, minecraft_username_normalized, email_normalized FROM users
      WHERE username_normalized = ? OR minecraft_username_normalized = ? OR email_normalized = ?
    `).get(normalizeUsername(username), normalizeUsername(username), emailNormalized);
    if (existing) {
      const code = existing.username_normalized === normalizeUsername(username)
        || existing.minecraft_username_normalized === normalizeUsername(username)
        ? 'username_taken'
        : 'email_taken';
      throw new ApiError(409, code, code === 'username_taken' ? 'Bu kullan1c1 ad1 kullan1mda.' : 'Bu e-posta adresi kullan1mda.');
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
        s.refresh_expires_at, u.username, u.email, u.email_verified
      FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id
      JOIN users u ON u.id = s.user_id WHERE r.token_hash = ?
    `).get(oldHash);
    if (!row) throw new ApiError(401, 'invalid_refresh_token', 'Yenileme belirteci geçersiz veya süresi dolmuş.');
    if (row.used_at) {
      database.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), row.session_id);
      throw new ApiError(401, 'refresh_token_reuse', 'Yenileme belirteci yeniden kullanılmış; oturum iptal edildi.');
    }
    if (row.expires_at <= nowMs || row.refresh_expires_at <= nowMs || row.revoked_at || !row.email_verified) {
      throw new ApiError(401, 'invalid_refresh_token', 'Yenileme belirteci geçersiz veya süresi dolmuş.');
    }
    const access = createOpaqueToken();
    const refresh = createOpaqueToken();
    const accessExpires = nowMs + accessTokenTtlSeconds * 1000;
    const refreshExpires = Math.min(
      nowMs + refreshTokenTtlDays * 24 * 60 * 60 * 1000,
      row.refresh_expires_at,
    );
    database.transaction(() => {
      const result = database.prepare('UPDATE refresh_tokens SET used_at = ?, replaced_by_hash = ? WHERE token_hash = ? AND used_at IS NULL')
        .run(new Date().toISOString(), refresh.tokenHash, oldHash);
      if (result.changes !== 1) throw new ApiError(401, 'refresh_token_reuse', 'Yenileme belirteci yeniden kullanılmış.');
      database.prepare('INSERT INTO access_tokens (token_hash, session_id, expires_at) VALUES (?, ?, ?)')
        .run(access.tokenHash, row.session_id, accessExpires);
      database.prepare('INSERT INTO refresh_tokens (token_hash, session_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(refresh.tokenHash, row.session_id, refreshExpires, new Date().toISOString());
      database.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), row.session_id);
    })();
    return reply.send({
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: accessTokenTtlSeconds,
      refreshExpiresIn: Math.floor((row.refresh_expires_at - nowMs) / 1000),
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
    const cape = database.prepare('SELECT updated_at FROM capes WHERE user_id = ?')
      .get(request.skinUser.id);
    const elytra = database.prepare('SELECT updated_at FROM elytras WHERE user_id = ?')
      .get(request.skinUser.id);
    return profileResponse(request.skinUser, skin, publicBaseUrl, cape, elytra);
  });

  app.get('/api/v1/friends', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'listFriends',
      tags: ['friends'],
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['friends', 'incomingRequests', 'outgoingRequests'],
          properties: {
            friends: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['userId', 'username', 'minecraftUsername', 'online', 'inGame'],
                properties: {
                  userId: { type: 'string' },
                  username: { type: 'string' },
                  minecraftUsername: { type: 'string', nullable: true },
                  online: { type: 'boolean' },
                  inGame: { type: 'boolean' },
                },
              },
            },
            incomingRequests: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['requestId', 'userId', 'username', 'createdAt'],
                properties: {
                  requestId: { type: 'string' },
                  userId: { type: 'string' },
                  username: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            outgoingRequests: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['requestId', 'userId', 'username', 'createdAt'],
                properties: {
                  requestId: { type: 'string' },
                  userId: { type: 'string' },
                  username: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    const onlineThreshold = Date.now() - 45_000;
    const friends = database.prepare(`
      SELECT users.id AS userId, users.username, users.minecraft_username AS minecraftUsername,
        CASE WHEN presence.last_seen_at > ? THEN 1 ELSE 0 END AS online,
        CASE WHEN presence.last_seen_at > ? AND presence.in_game = 1 THEN 1 ELSE 0 END AS in_game,
        presence.server_name AS serverName
      FROM friendships
      JOIN users ON users.id = CASE
        WHEN friendships.user_low_id = ? THEN friendships.user_high_id
        ELSE friendships.user_low_id
      END
      LEFT JOIN presence ON presence.user_id = users.id
      WHERE friendships.user_low_id = ? OR friendships.user_high_id = ?
      ORDER BY users.username COLLATE NOCASE
    `).all(onlineThreshold, onlineThreshold, request.skinUser.id, request.skinUser.id, request.skinUser.id);
    const incomingRequests = database.prepare(`
      SELECT friend_requests.id AS requestId, users.id AS userId, users.username, friend_requests.created_at AS createdAt
      FROM friend_requests
      JOIN users ON users.id = friend_requests.requester_user_id
      WHERE friend_requests.recipient_user_id = ? AND friend_requests.status = 'pending'
      ORDER BY friend_requests.created_at
    `).all(request.skinUser.id);
    const outgoingRequests = database.prepare(`
      SELECT friend_requests.id AS requestId, users.id AS userId, users.username, friend_requests.created_at AS createdAt
      FROM friend_requests
      JOIN users ON users.id = friend_requests.recipient_user_id
      WHERE friend_requests.requester_user_id = ? AND friend_requests.status = 'pending'
      ORDER BY friend_requests.created_at
    `).all(request.skinUser.id);
    return {
      friends: friends.map((friend) => ({
        userId: friend.userId,
        username: friend.username,
        minecraftUsername: friend.minecraftUsername ?? null,
        online: Boolean(friend.online),
        inGame: Boolean(friend.in_game),
        serverName: friend.serverName ?? null,
      })),
      incomingRequests,
      outgoingRequests,
    };
  });

  app.get('/api/v1/friends/search', {
    ...protectedRouteConfig,
  }, async (request) => {
    const query = String(request.query.q || '').trim().toLowerCase();
    return database.prepare(`
      SELECT id AS userId, username
      FROM users
      WHERE email_verified = 1
        AND LOWER(username) LIKE ? ESCAPE '\\'
        AND id != ?
        AND NOT EXISTS (
          SELECT 1 FROM friendships
          WHERE (user_low_id = ? AND user_high_id = users.id)
            OR (user_high_id = ? AND user_low_id = users.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests
          WHERE status = 'pending'
            AND ((requester_user_id = ? AND recipient_user_id = users.id)
              OR (recipient_user_id = ? AND requester_user_id = users.id))
        )
      ORDER BY LOWER(username)
      LIMIT 8
    `).all(
      `${query.replace(/[%_]/g, '\\$&')}%`,
      request.skinUser.id,
      request.skinUser.id,
      request.skinUser.id,
      request.skinUser.id,
      request.skinUser.id,
    );
  });

  app.post('/api/v1/friends/requests', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'sendFriendRequest',
      tags: ['friends'],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['username'],
        properties: { username: { type: 'string', minLength: 3, maxLength: 16 } },
      },
      response: {
        201: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } },
        200: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request, reply) => {
    const username = request.body.username.trim();
    if (!validateUsername(username)) {
      throw new ApiError(400, 'invalid_username', 'Westron kullanıcı adı geçersiz.');
    }
    const target = database.prepare(`
      SELECT id, username FROM users WHERE username_normalized = ?
    `).get(normalizeUsername(username));
    if (!target) throw new ApiError(404, 'user_not_found', 'Bu Westron kullanıcı adı bulunamadı.');
    if (target.id === request.skinUser.id) {
      throw new ApiError(400, 'cannot_friend_self', 'Kendinize arkadaşlık isteği gönderemezsiniz.');
    }
    if (friendshipExists(request.skinUser.id, target.id)) {
      throw new ApiError(409, 'already_friends', 'Bu kullanıcı zaten arkadaşınız.');
    }

    const now = new Date().toISOString();
    const outgoing = database.prepare(`
      SELECT id, status FROM friend_requests
      WHERE requester_user_id = ? AND recipient_user_id = ?
    `).get(request.skinUser.id, target.id);
    const reverse = database.prepare(`
      SELECT id FROM friend_requests
      WHERE requester_user_id = ? AND recipient_user_id = ? AND status = 'pending'
    `).get(target.id, request.skinUser.id);

    if (reverse) {
      database.transaction(() => {
        createFriendship(request.skinUser.id, target.id, now);
        database.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?")
          .run(now, reverse.id);
        if (outgoing) {
          database.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?")
            .run(now, outgoing.id);
        }
      }).immediate();
      return reply.send({ message: 'Arkadaşlık isteği karşılıklı olarak kabul edildi.' });
    }
    if (outgoing?.status === 'pending') {
      throw new ApiError(409, 'request_already_sent', 'Bu kullanıcıya zaten arkadaşlık isteği gönderdiniz.');
    }
    if (outgoing) {
      database.prepare(`
        UPDATE friend_requests SET status = 'pending', created_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, outgoing.id);
    } else {
      database.prepare(`
        INSERT INTO friend_requests (id, requester_user_id, recipient_user_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `).run(randomUUID(), request.skinUser.id, target.id, now, now);
    }
    return reply.code(201).send({ message: 'Arkadaşlık isteği gönderildi.' });
  });

  app.delete('/api/v1/friends/requests/:requestId', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'cancelFriendRequest',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['requestId'],
        properties: { requestId: { type: 'string', minLength: 36, maxLength: 36 } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['cancelled'],
          properties: { cancelled: { type: 'boolean', const: true } },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    const result = database.prepare(`
      DELETE FROM friend_requests
      WHERE id = ? AND requester_user_id = ? AND status = 'pending'
    `).run(request.params.requestId, request.skinUser.id);
    if (!result.changes) {
      throw new ApiError(404, 'friend_request_not_found', 'Arkadaşlık isteği bulunamadı veya artık geri alınamıyor.');
    }
    return { cancelled: true };
  });

  app.post('/api/v1/friends/requests/:requestId/respond', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'respondToFriendRequest',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['requestId'],
        properties: { requestId: { type: 'string', minLength: 36, maxLength: 36 } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['accept'],
        properties: { accept: { type: 'boolean' } },
      },
      response: {
        200: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    const respond = database.transaction(() => {
      const friendRequest = database.prepare(`
        SELECT requester_user_id FROM friend_requests
        WHERE id = ? AND recipient_user_id = ? AND status = 'pending'
      `).get(request.params.requestId, request.skinUser.id);
      if (!friendRequest) throw new ApiError(404, 'friend_request_not_found', 'Arkadaşlık isteği bulunamadı veya daha önce yanıtlandı.');
      const now = new Date().toISOString();
      const status = request.body.accept ? 'accepted' : 'rejected';
      database.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, request.params.requestId);
      if (request.body.accept) createFriendship(request.skinUser.id, friendRequest.requester_user_id, now);
      return status;
    });
    const status = respond.immediate();
    return { message: status === 'accepted' ? 'Arkadaşlık isteği kabul edildi.' : 'Arkadaşlık isteği reddedildi.' };
  });

  app.delete('/api/v1/friends/:friendUserId', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'removeFriend',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['friendUserId'],
        properties: { friendUserId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      response: {
        200: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    const friendUserId = request.params.friendUserId;
    const [userLowId, userHighId] = [request.skinUser.id, friendUserId].sort();
    const remove = database.transaction(() => {
      const result = database.prepare(`
        DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?
      `).run(userLowId, userHighId);
      if (!result.changes) throw new ApiError(404, 'friend_not_found', 'Arkadaş bulunamadı.');
      database.prepare(`
        DELETE FROM ephemeral_messages
        WHERE (sender_user_id = ? AND recipient_user_id = ?)
          OR (sender_user_id = ? AND recipient_user_id = ?)
      `).run(request.skinUser.id, friendUserId, friendUserId, request.skinUser.id);
      database.prepare(`
        DELETE FROM call_signals
        WHERE (sender_user_id = ? AND recipient_user_id = ?)
          OR (sender_user_id = ? AND recipient_user_id = ?)
      `).run(request.skinUser.id, friendUserId, friendUserId, request.skinUser.id);
    });
    remove.immediate();
    return { message: 'Arkadaş kaldırıldı.' };
  });

  app.get('/api/v1/friends/groups', {
    ...protectedRouteConfig,
  }, async (request) => {
    const groups = database.prepare(`
      SELECT friend_groups.id, friend_groups.name, friend_groups.owner_user_id AS ownerUserId,
        friend_groups.created_by_user_id AS createdByUserId,
        friend_groups.created_at AS createdAt
      FROM friend_groups
      JOIN friend_group_members ON friend_group_members.group_id = friend_groups.id
      WHERE friend_group_members.user_id = ?
      ORDER BY friend_groups.created_at DESC
    `).all(request.skinUser.id);
    return groups.map((group) => ({
      ...group,
      members: database.prepare(`
        SELECT users.id AS userId, users.username,
          users.minecraft_username AS minecraftUsername
        FROM friend_group_members
        JOIN users ON users.id = friend_group_members.user_id
        WHERE friend_group_members.group_id = ?
        ORDER BY users.username COLLATE NOCASE
      `).all(group.id),
    }));
  });

  app.post('/api/v1/friends/groups', {
    ...protectedRouteConfig,
  }, async (request, reply) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const memberIds = Array.isArray(request.body?.memberUserIds)
      ? [...new Set(request.body.memberUserIds.filter((id) => typeof id === 'string'))].slice(0, 16)
      : [];
    if (name.length < 1 || name.length > 32) {
      throw new ApiError(400, 'invalid_group_name', 'Grup adı 1-32 karakter olmalıdır.');
    }
    const validMembers = memberIds.filter((id) => friendshipExists(request.skinUser.id, id));
    const groupId = randomUUID();
    const now = new Date().toISOString();
    database.transaction(() => {
      database.prepare(`
        INSERT INTO friend_groups (id, name, owner_user_id, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(groupId, name, request.skinUser.id, request.skinUser.id, now);
      const insertMember = database.prepare(`
        INSERT OR IGNORE INTO friend_group_members (group_id, user_id, joined_at)
        VALUES (?, ?, ?)
      `);
      insertMember.run(groupId, request.skinUser.id, now);
      for (const memberId of validMembers) insertMember.run(groupId, memberId, now);
    })();
    return reply.code(201).send({ groupId, name });
  });

  app.delete('/api/v1/friends/groups/:groupId', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'deleteFriendGroup',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId'],
        properties: { groupId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['deleted'],
          properties: { deleted: { const: true } },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request) => {
    const { groupId } = request.params;
    const removeGroup = database.transaction(() => {
      const group = database.prepare(`
        SELECT owner_user_id AS ownerUserId FROM friend_groups WHERE id = ?
      `).get(groupId);
      const membership = database.prepare(`
        SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
      `).get(groupId, request.skinUser.id);
      if (!group || !membership) {
        throw new ApiError(404, 'group_not_found', 'Grup bulunamadı.');
      }
      if (group.ownerUserId !== request.skinUser.id) {
        throw new ApiError(403, 'group_owner_required', 'Grubu yalnızca sahibi silebilir.');
      }
      const photos = database.prepare(`
        SELECT photo_file_name AS photoFileName
        FROM friend_group_messages
        WHERE group_id = ? AND photo_file_name IS NOT NULL
      `).all(groupId);
      database.prepare(`
        DELETE FROM call_signals
        WHERE group_id = ? AND type NOT IN ('hangup', 'reject')
      `).run(groupId);
      database.prepare('DELETE FROM friend_groups WHERE id = ?').run(groupId);
      return photos;
    });
    const photos = removeGroup.immediate();
    for (const { photoFileName } of photos) {
      if (/^[0-9a-f-]{36}\.png$/i.test(photoFileName)) {
        await rm(path.join(photosDir, photoFileName), { force: true });
      }
    }
    return { deleted: true };
  });

  app.patch('/api/v1/friends/groups/:groupId', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'renameFriendGroup',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId'],
        properties: { groupId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 32 } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['groupId', 'name'],
          properties: { groupId: { type: 'string' }, name: { type: 'string' } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request) => {
    const name = request.body.name.trim();
    if (!name) throw new ApiError(400, 'invalid_group_name', 'Grup adı 1-32 karakter olmalıdır.');
    const group = database.prepare(`
      SELECT created_by_user_id AS createdByUserId FROM friend_groups WHERE id = ?
    `).get(request.params.groupId);
    if (!group) throw new ApiError(404, 'group_not_found', 'Grup bulunamadı.');
    const membership = database.prepare(`
      SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
    `).get(request.params.groupId, request.skinUser.id);
    if (!membership) throw new ApiError(404, 'group_not_found', 'Grup bulunamadı.');
    if (group.createdByUserId !== request.skinUser.id) {
      throw new ApiError(403, 'group_owner_required', 'Grup adını yalnızca grubu oluşturan kişi değiştirebilir.');
    }
    database.prepare('UPDATE friend_groups SET name = ? WHERE id = ?').run(name, request.params.groupId);
    return { groupId: request.params.groupId, name };
  });

  app.delete('/api/v1/friends/groups/:groupId/members/:memberUserId', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'removeFriendGroupMember',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId', 'memberUserId'],
        properties: {
          groupId: { type: 'string', minLength: 1, maxLength: 64 },
          memberUserId: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['removed', 'groupDeleted'],
          properties: { removed: { const: true }, groupDeleted: { type: 'boolean' } },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request) => {
    const { groupId, memberUserId } = request.params;
    const group = database.prepare(`
      SELECT owner_user_id AS ownerUserId FROM friend_groups WHERE id = ?
    `).get(groupId);
    const membership = database.prepare(`
      SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
    `).get(groupId, request.skinUser.id);
    const targetMembership = database.prepare(`
      SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
    `).get(groupId, memberUserId);
    if (!group || !membership || !targetMembership) {
      throw new ApiError(404, 'group_member_not_found', 'Grup üyesi bulunamadı.');
    }
    if (group.ownerUserId !== request.skinUser.id && memberUserId !== request.skinUser.id) {
      throw new ApiError(403, 'group_owner_required', 'Yalnızca grup sahibi üye çıkarabilir.');
    }
    const groupPhotos = memberUserId === group.ownerUserId
      ? database.prepare(`
        SELECT photo_file_name AS photoFileName
        FROM friend_group_messages
        WHERE group_id = ? AND photo_file_name IS NOT NULL
      `).all(groupId)
      : [];
    const removeMember = database.transaction(() => {
      database.prepare(`
        DELETE FROM call_signals
        WHERE group_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)
      `).run(groupId, memberUserId, memberUserId);
      if (memberUserId === group.ownerUserId) {
        const nextOwner = database.prepare(`
          SELECT user_id AS userId
          FROM friend_group_members
          WHERE group_id = ? AND user_id != ?
          ORDER BY joined_at ASC, user_id ASC
          LIMIT 1
        `).get(groupId, memberUserId);
        if (nextOwner) {
          database.prepare('UPDATE friend_groups SET owner_user_id = ? WHERE id = ?')
            .run(nextOwner.userId, groupId);
        } else {
          database.prepare('DELETE FROM call_signals WHERE group_id = ?').run(groupId);
          database.prepare('DELETE FROM friend_groups WHERE id = ?').run(groupId);
          return true;
        }
      }
      database.prepare('DELETE FROM friend_group_members WHERE group_id = ? AND user_id = ?')
        .run(groupId, memberUserId);
      return false;
    });
    const groupDeleted = removeMember.immediate();
    if (groupDeleted) {
      for (const { photoFileName } of groupPhotos) {
        await rm(path.join(photosDir, photoFileName), { force: true });
      }
    }
    return { removed: true, groupDeleted };
  });

  app.get('/api/v1/friends/groups/:groupId/messages', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'listFriendGroupMessages',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId'],
        properties: { groupId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['messageId', 'senderUserId', 'senderUsername', 'body', 'kind', 'createdAt'],
            properties: {
              messageId: { type: 'string' },
              senderUserId: { type: 'string' },
              senderUsername: { type: 'string' },
              body: { type: 'string' },
              kind: { type: 'string', enum: ['text', 'photo'] },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request) => {
    await cleanExpiredMessages();
    const isMember = database.prepare(`
      SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
    `).get(request.params.groupId, request.skinUser.id);
    if (!isMember) throw new ApiError(404, 'group_not_found', 'Grup bulunamadı.');
    return database.prepare(`
      SELECT friend_group_messages.id AS messageId,
        friend_group_messages.sender_user_id AS senderUserId,
        users.username AS senderUsername,
        friend_group_messages.body,
        friend_group_messages.kind,
        friend_group_messages.created_at AS createdAt
      FROM friend_group_messages
      JOIN users ON users.id = friend_group_messages.sender_user_id
      WHERE friend_group_messages.group_id = ?
      ORDER BY friend_group_messages.created_at DESC, friend_group_messages.rowid DESC
      LIMIT 200
    `).all(request.params.groupId).reverse();
  });

  app.post('/api/v1/friends/groups/:groupId/messages/photo', {
    ...protectedRouteConfig,
    bodyLimit: MAX_PHOTO_UPLOAD_BYTES + 64 * 1024,
    schema: {
      operationId: 'sendFriendGroupPhoto',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId'],
        properties: { groupId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: false,
          required: ['messageId', 'kind'],
          properties: { messageId: { type: 'string' }, kind: { const: 'photo' } },
        },
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
        413: errorResponse,
        415: errorResponse,
      },
    },
  }, async (request, reply) => {
    if (!request.isMultipart()) {
      throw new ApiError(415, 'unsupported_media_type', 'Dosya yüklemesi multipart/form-data biçiminde olmalıdır.');
    }
    const membership = database.prepare(`
      SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
    `).get(request.params.groupId, request.skinUser.id);
    if (!membership) throw new ApiError(404, 'group_not_found', 'Grup bulunamadı.');
    let photoBuffer = null;
    for await (const part of request.parts({
      limits: { fileSize: MAX_PHOTO_UPLOAD_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 32 },
    })) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        photoBuffer = await part.toBuffer();
      }
    }
    const png = await normalizeUploadedPhoto(photoBuffer);
    const messageId = randomUUID();
    const photoFileName = `${randomUUID()}.png`;
    const photoPath = path.join(photosDir, photoFileName);
    await writeFile(photoPath, png, { mode: 0o600 });
    try {
      database.prepare(`
        INSERT INTO friend_group_messages
          (id, group_id, sender_user_id, body, kind, photo_file_name, created_at)
        VALUES (?, ?, ?, '', 'photo', ?, ?)
      `).run(messageId, request.params.groupId, request.skinUser.id, photoFileName, new Date().toISOString());
    } catch (error) {
      await rm(photoPath, { force: true });
      throw error;
    }
    return reply.code(201).send({ messageId, kind: 'photo' });
  });

  app.get('/api/v1/friends/groups/:groupId/messages/:messageId/photo', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'getFriendGroupPhoto',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId', 'messageId'],
        properties: {
          groupId: { type: 'string', minLength: 1, maxLength: 64 },
          messageId: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
        },
      },
      response: {
        200: { type: 'string', format: 'binary' },
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    await cleanExpiredMessages();
    const message = database.prepare(`
      SELECT friend_group_messages.photo_file_name AS photoFileName
      FROM friend_group_messages
      JOIN friend_group_members ON friend_group_members.group_id = friend_group_messages.group_id
      WHERE friend_group_messages.id = ? AND friend_group_messages.group_id = ?
        AND friend_group_messages.kind = 'photo' AND friend_group_members.user_id = ?
    `).get(request.params.messageId, request.params.groupId, request.skinUser.id);
    if (!message?.photoFileName || !/^[0-9a-f-]{36}\.png$/i.test(message.photoFileName)) {
      throw new ApiError(404, 'group_photo_not_found', 'Grup fotoğrafı bulunamadı.');
    }
    let photo;
    try {
      photo = await readFile(path.join(photosDir, message.photoFileName));
    } catch (error) {
      if (error.code === 'ENOENT') throw new ApiError(404, 'group_photo_not_found', 'Grup fotoğrafı bulunamadı.');
      throw error;
    }
    return reply.type('image/png').header('Cache-Control', 'private, no-store').send(photo);
  });

  app.post('/api/v1/friends/groups/:groupId/messages', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'sendFriendGroupMessage',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId'],
        properties: { groupId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: { body: { type: 'string', minLength: 1, maxLength: 2000 } },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: false,
          required: ['messageId', 'kind'],
          properties: { messageId: { type: 'string' }, kind: { const: 'text' } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const body = request.body.body.trim();
    if (!body) throw new ApiError(400, 'empty_message', 'Mesaj boş olamaz.');
    const isMember = database.prepare(`
      SELECT 1 FROM friend_group_members WHERE group_id = ? AND user_id = ?
    `).get(request.params.groupId, request.skinUser.id);
    if (!isMember) throw new ApiError(404, 'group_not_found', 'Grup bulunamadı.');
    const messageId = randomUUID();
    database.prepare(`
      INSERT INTO friend_group_messages (id, group_id, sender_user_id, body, kind, created_at)
      VALUES (?, ?, ?, ?, 'text', ?)
    `).run(messageId, request.params.groupId, request.skinUser.id, body, new Date().toISOString());
    return reply.code(201).send({ messageId, kind: 'text' });
  });

  app.post('/api/v1/friends/groups/:groupId/messages/:messageId/recall', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'recallFriendGroupMessage',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['groupId', 'messageId'],
        properties: {
          groupId: { type: 'string', minLength: 1, maxLength: 64 },
          messageId: { type: 'string', minLength: 36, maxLength: 36 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['recalled'],
          properties: { recalled: { type: 'boolean', const: true } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request) => {
    const { groupId, messageId } = request.params;
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) {
      throw new ApiError(400, 'invalid_message_id', 'Mesaj kimliği geçersiz.');
    }
    const message = database.prepare(`
      SELECT photo_file_name AS photoFileName
      FROM friend_group_messages
      WHERE id = ? AND group_id = ? AND sender_user_id = ?
    `).get(messageId, groupId, request.skinUser.id);
    if (!message) throw new ApiError(404, 'group_message_not_found', 'Mesaj bulunamadı veya geri alınamaz.');
    if (message.photoFileName && /^[0-9a-f-]{36}\.png$/i.test(message.photoFileName)) {
      await rm(path.join(photosDir, message.photoFileName), { force: true });
    }
    database.prepare(`
      DELETE FROM friend_group_messages
      WHERE id = ? AND group_id = ? AND sender_user_id = ?
    `).run(messageId, groupId, request.skinUser.id);
    return { recalled: true };
  });

  app.post('/api/v1/presence', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'updatePresence',
      tags: ['presence'],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['inGame'],
        properties: {
          inGame: { type: 'boolean' },
          serverName: { type: 'string', maxLength: 128 },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: false, required: ['updated'], properties: { updated: { type: 'boolean', const: true } } },
        401: errorResponse,
        403: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    database.prepare(`
      INSERT INTO presence (user_id, in_game, server_name, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        in_game = excluded.in_game,
        server_name = excluded.server_name,
        last_seen_at = excluded.last_seen_at
    `).run(
      request.skinUser.id,
      request.body.inGame ? 1 : 0,
      typeof request.body.serverName === 'string' ? request.body.serverName.trim() || null : null,
      Date.now(),
    );
    return { updated: true };
  });

  app.post('/api/v1/friends/messages/photo', {
    ...protectedRouteConfig,
    bodyLimit: MAX_PHOTO_UPLOAD_BYTES + 64 * 1024,
  }, async (request, reply) => {
    if (!request.isMultipart()) throw new ApiError(415, 'unsupported_media_type', 'Dosya yüklemesi multipart/form-data biçiminde olmalıdır.');
    let recipientUserId = '';
    let photoBuffer = null;
    for await (const part of request.parts({
      limits: { fileSize: MAX_PHOTO_UPLOAD_BYTES, files: 1, fields: 1, parts: 2, fieldNameSize: 32 },
    })) {
      if (part.type === 'field' && part.fieldname === 'recipientUserId') {
        recipientUserId = String(part.value || '').trim();
      }
      if (part.type === 'file' && part.fieldname === 'photo') {
        photoBuffer = await part.toBuffer();
      }
    }
    if (!recipientUserId || recipientUserId.length > 64) {
      throw new ApiError(400, 'invalid_photo_recipient', 'Fotoğraf alıcısı geçersiz.');
    }
    if (!friendshipExists(request.skinUser.id, recipientUserId)) {
      throw new ApiError(404, 'friend_not_found', 'Bu kullanıcı arkadaş listenizde bulunmuyor.');
    }
    const png = await normalizeUploadedPhoto(photoBuffer);
    const photoId = randomUUID();
    const photoFileName = `${photoId}.png`;
    await writeFile(path.join(photosDir, photoFileName), png, { mode: 0o600 });
    const photoUrl = `${publicBaseUrl}/api/v1/friends/messages/photo/${encodeURIComponent(photoFileName)}`;
    const messageId = randomUUID();
    database.prepare(`
      INSERT INTO ephemeral_messages (id, sender_user_id, recipient_user_id, body, kind, photo_url, created_at, expires_at)
      VALUES (?, ?, ?, '', 'photo', ?, ?, ?)
    `).run(messageId, request.skinUser.id, recipientUserId, photoUrl, new Date().toISOString(),
      Date.now() + 30 * 24 * 60 * 60 * 1000);
    return reply.code(201).send({ messageId, photoUrl });
  });

  app.get('/api/v1/friends/messages/photo/:photoFileName', {
    schema: {
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['photoFileName'],
        properties: { photoFileName: { type: 'string', pattern: '^[0-9a-f-]{36}\\.png$' } },
      },
    },
  }, async (request, reply) => {
    const photoFileName = request.params.photoFileName;
    const photoPath = path.join(photosDir, photoFileName);
    const message = database.prepare(`
      SELECT id FROM ephemeral_messages
      WHERE photo_url = ? AND kind = 'photo' AND expires_at > ?
    `).get(`${publicBaseUrl}/api/v1/friends/messages/photo/${encodeURIComponent(photoFileName)}`, Date.now());
    if (!message) throw new ApiError(404, 'photo_not_found', 'Fotoğraf bulunamadı.');
    let photo;
    try {
      photo = await readFile(photoPath);
    } catch (error) {
      if (error.code === 'ENOENT') throw new ApiError(404, 'photo_not_found', 'Fotoğraf bulunamadı.');
      throw error;
    }
    return reply.header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, no-store')
      .send(photo);
  });

  app.get('/api/v1/friends/messages/:messageId/photo', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'viewFriendPhoto',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId'],
        properties: { messageId: { type: 'string', pattern: '^[0-9a-f-]{36}$' } },
      },
      response: {
        200: { type: 'string', format: 'binary', 'content-type': 'image/png' },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        410: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request, reply) => {
    const message = database.prepare(`
      SELECT sender_user_id AS senderUserId, recipient_user_id AS recipientUserId,
        photo_url AS photoUrl
      FROM ephemeral_messages
      WHERE id = ? AND kind = 'photo' AND expires_at > ?
    `).get(request.params.messageId, Date.now());
    if (!message
      || (message.senderUserId !== request.skinUser.id
        && message.recipientUserId !== request.skinUser.id)) {
      throw new ApiError(404, 'photo_not_found', 'Fotoğraf bulunamadı.');
    }
    const photoFileName = path.basename(new URL(message.photoUrl).pathname);
    let photo;
    try {
      photo = await readFile(path.join(photosDir, photoFileName));
    } catch (error) {
      if (error.code === 'ENOENT') throw new ApiError(404, 'photo_not_found', 'Fotoğraf bulunamadı.');
      throw error;
    }
    return reply.header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, no-store')
      .send(photo);
  });

  app.post('/api/v1/friends/messages', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'sendEphemeralMessage',
      tags: ['friends'],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['recipientUserId', 'body'],
        properties: {
          recipientUserId: { type: 'string', minLength: 1, maxLength: 64 },
          body: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: false, required: ['messageId'], properties: { messageId: { type: 'string' } } },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request, reply) => {
    const body = request.body.body.trim();
    if (!body) throw new ApiError(400, 'empty_message', 'Mesaj boş olamaz.');
    if (!friendshipExists(request.skinUser.id, request.body.recipientUserId)) {
      throw new ApiError(404, 'friend_not_found', 'Bu kullanıcı arkadaş listenizde bulunmuyor.');
    }
    const messageId = randomUUID();
    database.prepare(`
      INSERT INTO ephemeral_messages (id, sender_user_id, recipient_user_id, body, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      request.skinUser.id,
      request.body.recipientUserId,
      body,
      new Date().toISOString(),
      Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
    );
    return reply.code(201).send({ messageId });
  });

  app.get('/api/v1/friends/messages/inbox', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'listEphemeralMessages',
      tags: ['friends'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['messageId', 'senderUserId', 'senderUsername', 'createdAt', 'kind'],
            properties: {
              messageId: { type: 'string' },
              senderUserId: { type: 'string' },
              senderUsername: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              kind: { type: 'string', enum: ['text', 'photo'] },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    await cleanExpiredMessages();
    return database.prepare(`
      SELECT ephemeral_messages.id AS messageId, users.id AS senderUserId,
        users.username AS senderUsername, ephemeral_messages.created_at AS createdAt,
        ephemeral_messages.kind
      FROM ephemeral_messages
      JOIN users ON users.id = ephemeral_messages.sender_user_id
      WHERE ephemeral_messages.recipient_user_id = ? AND ephemeral_messages.expires_at > ?
      ORDER BY ephemeral_messages.created_at DESC
      LIMIT 100
    `).all(request.skinUser.id, Date.now());
  });

  app.get('/api/v1/friends/messages/conversation/:friendUserId', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'getFriendConversation',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['friendUserId'],
        properties: { friendUserId: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['messageId', 'senderUserId', 'senderUsername', 'recipientUserId', 'body', 'kind', 'createdAt', 'photoViewedByMe'],
            properties: {
              messageId: { type: 'string' },
              senderUserId: { type: 'string' },
              senderUsername: { type: 'string' },
              recipientUserId: { type: 'string' },
              body: { type: 'string' },
              kind: { type: 'string', enum: ['text', 'photo'] },
              photoUrl: { type: 'string', format: 'uri', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              photoViewedByMe: { type: 'boolean' },
            },
          },
        },
        401: errorResponse,
        404: errorResponse,
      },
    },
  }, async (request) => {
    const friendUserId = request.params.friendUserId;
    if (!friendshipExists(request.skinUser.id, friendUserId)) {
      throw new ApiError(404, 'friend_not_found', 'Bu kullanıcı arkadaş listenizde bulunmuyor.');
    }
    await cleanExpiredMessages();
    return database.prepare(`
      SELECT ephemeral_messages.id AS messageId,
        ephemeral_messages.sender_user_id AS senderUserId,
        sender.username AS senderUsername,
        ephemeral_messages.recipient_user_id AS recipientUserId,
        ephemeral_messages.body,
        ephemeral_messages.kind,
        ephemeral_messages.photo_url AS photoUrl,
        0 AS photoViewedByMe,
        ephemeral_messages.created_at AS createdAt
      FROM ephemeral_messages
      JOIN users AS sender ON sender.id = ephemeral_messages.sender_user_id
      WHERE ephemeral_messages.expires_at > ?
        AND ((ephemeral_messages.sender_user_id = ? AND ephemeral_messages.recipient_user_id = ?)
          OR (ephemeral_messages.sender_user_id = ? AND ephemeral_messages.recipient_user_id = ?))
      ORDER BY ephemeral_messages.created_at ASC
      LIMIT 200
    `).all(Date.now(), request.skinUser.id, friendUserId, friendUserId, request.skinUser.id)
      .map((message) => ({ ...message, photoViewedByMe: Boolean(message.photoViewedByMe) }));
  });

  const recallFriendMessage = async (request) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.messageId)) {
      throw new ApiError(400, 'invalid_message_id', 'Mesaj kimliği geçersiz.');
    }
    const message = database.prepare(`
      SELECT id, photo_url AS photoUrl
      FROM ephemeral_messages
      WHERE id = ? AND sender_user_id = ?
    `).get(request.params.messageId, request.skinUser.id);
    if (!message) throw new ApiError(404, 'message_not_found', 'Mesaj bulunamadı veya geri alınamaz.');
    if (message.photoUrl) {
      const photoName = path.basename(new URL(message.photoUrl).pathname);
      await rm(path.join(photosDir, photoName), { force: true });
    }
    database.prepare('DELETE FROM ephemeral_messages WHERE id = ? AND sender_user_id = ?')
      .run(request.params.messageId, request.skinUser.id);
    return { recalled: true };
  };
  app.post('/api/v1/friends/messages/:messageId/recall', {
    ...protectedRouteConfig,
  }, recallFriendMessage);
  app.delete('/api/v1/friends/messages/:messageId', {
    ...protectedRouteConfig,
  }, recallFriendMessage);

  app.post('/api/v1/friends/messages/:messageId/consume', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'consumeEphemeralMessage',
      tags: ['friends'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId'],
        properties: { messageId: { type: 'string', minLength: 36, maxLength: 36 } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['senderUserId', 'senderUsername', 'body', 'createdAt'],
          properties: {
            senderUserId: { type: 'string' },
            senderUsername: { type: 'string' },
            body: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    const consume = database.transaction(() => {
      const message = database.prepare(`
        SELECT ephemeral_messages.sender_user_id AS senderUserId, users.username AS senderUsername,
          ephemeral_messages.body, ephemeral_messages.created_at AS createdAt
        FROM ephemeral_messages
        JOIN users ON users.id = ephemeral_messages.sender_user_id
        WHERE ephemeral_messages.id = ?
          AND ephemeral_messages.recipient_user_id = ?
          AND ephemeral_messages.expires_at > ?
      `).get(request.params.messageId, request.skinUser.id, Date.now());
      if (!message) throw new ApiError(404, 'message_not_found', 'Mesaj bulunamadı veya daha önce açıldı.');
      return message;
    });
    return consume.immediate();
  });

  app.get('/api/v1/friends/calls/ice-servers', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'getVoiceCallIceServers',
      tags: ['friends'],
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['iceServers'],
          properties: {
            iceServers: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['urls'],
                properties: {
                  urls: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
                  username: { type: 'string' },
                  credential: { type: 'string' },
                },
              },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        429: errorResponse,
      },
    },
  }, async () => ({ iceServers }));

  app.post('/api/v1/friends/calls/signals', {
    ...protectedRouteConfig,
    bodyLimit: 128 * 1024,
    schema: {
      operationId: 'sendVoiceCallSignal',
      tags: ['friends'],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['recipientUserId', 'callId', 'type', 'sdp'],
        properties: {
          recipientUserId: { type: 'string', minLength: 1, maxLength: 64 },
          callId: { type: 'string', minLength: 36, maxLength: 36 },
          groupId: { type: 'string', minLength: 36, maxLength: 36 },
          type: { type: 'string', enum: ['offer', 'answer', 'candidate', 'hangup', 'reject'] },
          sdp: { type: 'string', maxLength: 60000 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['sent'],
          properties: { sent: { const: false } },
        },
        202: { type: 'object', additionalProperties: false, required: ['sent'], properties: { sent: { type: 'boolean', const: true } } },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request, reply) => {
    const { recipientUserId, callId, type, sdp } = request.body;
    const groupId = request.body.groupId ?? null;
    if (!/^[0-9a-f-]{36}$/i.test(callId)) throw new ApiError(400, 'invalid_call_id', 'Arama oturumu geçersiz.');
    if (groupId !== null && !/^[0-9a-f-]{36}$/i.test(groupId)) {
      throw new ApiError(400, 'invalid_group_id', 'Arama grubu geçersiz.');
    }
    if (type !== 'hangup' && type !== 'reject' && !sdp.trim()) {
      throw new ApiError(400, 'invalid_call_description', 'Arama bağlantı bilgisi boş olamaz.');
    }
    if (type === 'candidate') {
      let candidate;
      try {
        candidate = JSON.parse(sdp);
      } catch {
        throw new ApiError(400, 'invalid_ice_candidate', 'Arama ağ adayı geçersiz.');
      }
      if (!candidate || typeof candidate !== 'object'
        || typeof candidate.candidate !== 'string' || candidate.candidate.length > 2048
        || (candidate.sdpMid !== null && typeof candidate.sdpMid !== 'string')
        || (candidate.sdpMLineIndex !== null && !Number.isSafeInteger(candidate.sdpMLineIndex))
        || (candidate.usernameFragment !== undefined && typeof candidate.usernameFragment !== 'string')) {
        throw new ApiError(400, 'invalid_ice_candidate', 'Arama ağ adayı geçersiz.');
      }
    }
    if (groupId) {
      const members = database.prepare(`
        SELECT COUNT(*) AS count
        FROM friend_group_members
        WHERE group_id = ? AND user_id IN (?, ?)
      `).get(groupId, request.skinUser.id, recipientUserId);
      if (members.count !== 2) {
        if (type === 'hangup' || type === 'reject') return reply.code(200).send({ sent: false });
        throw new ApiError(404, 'group_not_found', 'Arama grubu bulunamadı.');
      }
    } else if (!friendshipExists(request.skinUser.id, recipientUserId)) {
      throw new ApiError(404, 'friend_not_found', 'Bu kullanıcı arkadaş listenizde bulunmuyor.');
    }
    const now = Date.now();
    database.prepare('DELETE FROM call_signals WHERE expires_at <= ?').run(now);
    database.prepare(`
      INSERT INTO call_signals (
        id, sender_user_id, recipient_user_id, group_id, call_id, type, sdp, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      request.skinUser.id,
      recipientUserId,
      groupId,
      callId,
      type,
      sdp,
      new Date(now).toISOString(),
      now + 60_000,
    );
    return reply.code(202).send({ sent: true });
  });

  app.get('/api/v1/friends/calls/signals', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'consumeVoiceCallSignals',
      tags: ['friends'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['signalId', 'fromUserId', 'fromUsername', 'callId', 'type', 'sdp', 'groupId'],
            properties: {
              signalId: { type: 'string' },
              fromUserId: { type: 'string' },
              fromUsername: { type: 'string' },
              groupId: { type: 'string', nullable: true },
              callId: { type: 'string' },
              type: { type: 'string', enum: ['offer', 'answer', 'candidate', 'hangup', 'reject'] },
              sdp: { type: 'string' },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request) => {
    const now = Date.now();
    database.prepare('DELETE FROM call_signals WHERE expires_at <= ?').run(now);
    const signals = database.prepare(`
      SELECT call_signals.id AS signalId, users.id AS fromUserId, users.username AS fromUsername,
        call_signals.group_id AS groupId,
        call_signals.call_id AS callId, call_signals.type, call_signals.sdp
      FROM call_signals
      JOIN users ON users.id = call_signals.sender_user_id
      WHERE call_signals.recipient_user_id = ? AND call_signals.expires_at > ?
      ORDER BY call_signals.created_at
      LIMIT 50
    `).all(request.skinUser.id, now);
    if (signals.length) {
      database.prepare(`
        DELETE FROM call_signals WHERE id IN (${signals.map(() => '?').join(',')})
      `).run(...signals.map((signal) => signal.signalId));
    }
    return signals;
  });

  app.put('/api/v1/me/minecraft-profile', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'setMinecraftProfile',
      tags: ['profiles'],
      body: minecraftProfileBody,
      response: {
        200: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
        429: errorResponse,
      },
    },
  }, async (request, reply) => {
    const minecraftUsername = request.body.username;
    if (!validateUsername(minecraftUsername)) {
      throw new ApiError(400, 'invalid_minecraft_username', 'Minecraft kullanıcı adı 3-16 karakter olmalıdır.');
    }
    const normalizedUsername = normalizeUsername(minecraftUsername);
    const conflict = database.prepare(`
      SELECT id FROM users
      WHERE (username_normalized = ? OR minecraft_username_normalized = ?) AND id != ?
    `).get(normalizedUsername, normalizedUsername, request.skinUser.id);
    if (conflict) {
      throw new ApiError(409, 'minecraft_username_taken', 'Bu Minecraft kullanıcı adı başka bir Westron profiline bağlı.');
    }
    database.prepare(`
      UPDATE users
      SET minecraft_username = ?, minecraft_username_normalized = ?
      WHERE id = ?
    `).run(minecraftUsername, normalizedUsername, request.skinUser.id);
    return reply.send({ message: 'Minecraft kullanıcı adı Westron profiline bağlandı.' });
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
    const cape = database.prepare('SELECT updated_at FROM capes WHERE user_id = ?').get(request.skinUser.id);
    const elytra = database.prepare('SELECT updated_at FROM elytras WHERE user_id = ?').get(request.skinUser.id);
    const response = profileResponse(request.skinUser, skin, publicBaseUrl, cape, elytra);
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
  }, async (request, reply) => {
    const normalizedUsername = normalizeUsername(request.params.username);
    const user = database.prepare(`
      SELECT id, username FROM users
      WHERE username_normalized = ? OR minecraft_username_normalized = ?
      ORDER BY CASE WHEN username_normalized = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(normalizedUsername, normalizedUsername, normalizedUsername);
    if (!user) throw new ApiError(404, 'profile_not_found', 'Oyuncu profili bulunamadı.');
    const skin = database.prepare('SELECT model, updated_at FROM skins WHERE user_id = ?').get(user.id);
    const cape = database.prepare('SELECT updated_at FROM capes WHERE user_id = ?').get(user.id);
    const elytra = database.prepare('SELECT updated_at FROM elytras WHERE user_id = ?').get(user.id);
    reply.header('Access-Control-Allow-Origin', '*');
    return profileResponse(user, skin, publicBaseUrl, cape, elytra);
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
      WHERE users.username_normalized = ? OR users.minecraft_username_normalized = ?
      ORDER BY CASE WHEN users.username_normalized = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(
      normalizeUsername(request.params.username),
      normalizeUsername(request.params.username),
      normalizeUsername(request.params.username),
    );
    if (!skin) throw new ApiError(404, 'skin_not_found', 'Oyuncunun yüklenmiş bir skini yok.');
    reply.header('Access-Control-Allow-Origin', '*');
    const etag = `"${skin.sha256}"`;
    reply.header('Cache-Control', 'public, max-age=60, must-revalidate');
    reply.header('ETag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    const image = await readFile(path.join(skinsDir, skin.storage_key));
    return reply.type('image/png').send(image);
  });


  app.post('/api/v1/me/cape', {
    ...skinUploadRouteConfig,
    schema: {
      operationId: 'uploadCape',
      tags: ['capes'],
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
  }, async (request, reply) => saveBackTexture(request, reply, { type: 'cape', replace: false }));

  app.put('/api/v1/me/cape', {
    ...skinUploadRouteConfig,
    schema: {
      operationId: 'changeCape',
      tags: ['capes'],
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
  }, async (request, reply) => saveBackTexture(request, reply, { type: 'cape', replace: true }));

  app.post('/api/v1/me/elytra', {
    ...skinUploadRouteConfig,
    schema: {
      operationId: 'uploadElytra',
      tags: ['elytras'],
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
  }, async (request, reply) => saveBackTexture(request, reply, { type: 'elytra', replace: false }));

  app.put('/api/v1/me/elytra', {
    ...skinUploadRouteConfig,
    schema: {
      operationId: 'changeElytra',
      tags: ['elytras'],
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
  }, async (request, reply) => saveBackTexture(request, reply, { type: 'elytra', replace: true }));

  async function saveBackTexture(request, reply, { type, replace }) {
    const table = `${type}s`;
    const label = type === 'cape' ? 'Pelerin' : 'Elitra';
    const existing = database.prepare(`SELECT storage_key FROM ${table} WHERE user_id = ?`).get(request.skinUser.id);
    if (replace && !existing) {
      throw new ApiError(404, `${type}_not_found`, `Değiştirilecek bir ${label.toLowerCase()} bulunamadı.`);
    }
    if (!replace && existing) {
      throw new ApiError(409, `${type}_exists`, `${label} zaten mevcut; değiştirmek için PUT kullanın.`);
    }

    const part = await request.file();
    if (!part) throw new ApiError(400, `${type}_required`, `${type} alanında bir PNG dosyası gönderin.`);
    if (part.fieldname !== type || part.mimetype !== 'image/png') {
      part.file.resume();
      throw new ApiError(415, `invalid_${type}_format`, `Dosya image/png türünde ve ${type} alanında olmalıdır.`);
    }
    const buffer = await part.toBuffer();
    if (part.file.truncated) {
      throw new ApiError(413, `invalid_${type}_size`, `${label} PNG dosyası 1 MiB sınırını aşıyor.`);
    }
    const image = await (type === 'cape' ? validateCapePng(buffer) : validateElytraPng(buffer));
    const persist = type === 'cape' ? persistCape : persistElytra;
    await persist({
      userId: request.skinUser.id,
      image,
      skinsDir,
      database,
      logger: request.log,
      replace,
    });
    const skin = database.prepare('SELECT model, updated_at FROM skins WHERE user_id = ?').get(request.skinUser.id);
    const cape = database.prepare('SELECT updated_at FROM capes WHERE user_id = ?').get(request.skinUser.id);
    const elytra = database.prepare('SELECT updated_at FROM elytras WHERE user_id = ?').get(request.skinUser.id);
    const response = profileResponse(request.skinUser, skin, publicBaseUrl, cape, elytra);
    return reply.code(replace ? 200 : 201).send(response);
  }

  app.delete('/api/v1/me/cape', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'deleteMyCape',
      tags: ['capes'],
      response: {
        204: { type: 'null' },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => deleteBackTexture(request, reply, 'cape'));

  app.get('/api/v1/profiles/:username/cape.png', {
    schema: {
      operationId: 'getPlayerCape',
      tags: ['capes'],
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
  }, async (request, reply) => sendPublicBackTexture(request, reply, 'cape'));

  app.delete('/api/v1/me/elytra', {
    ...protectedRouteConfig,
    schema: {
      operationId: 'deleteMyElytra',
      tags: ['elytras'],
      response: {
        204: { type: 'null' },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        429: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => deleteBackTexture(request, reply, 'elytra'));

  app.get('/api/v1/profiles/:username/elytra.png', {
    schema: {
      operationId: 'getPlayerElytra',
      tags: ['elytras'],
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
  }, async (request, reply) => sendPublicBackTexture(request, reply, 'elytra'));

  async function deleteBackTexture(request, reply, type) {
    const table = `${type}s`;
    const label = type === 'cape' ? 'pelerin' : 'elitra';
    const texture = database.prepare(`SELECT storage_key FROM ${table} WHERE user_id = ?`).get(request.skinUser.id);
    if (!texture) throw new ApiError(404, `${type}_not_found`, `Kaldırılacak bir ${label} bulunamadı.`);
    database.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(request.skinUser.id);
    await removeSkinFile(skinsDir, texture.storage_key, request.log);
    return reply.code(204).send();
  }

  async function sendPublicBackTexture(request, reply, type) {
    const table = `${type}s`;
    const label = type === 'cape' ? 'pelerin' : 'elitra';
    const texture = database.prepare(`
      SELECT ${table}.storage_key, ${table}.sha256 FROM ${table}
      JOIN users ON users.id = ${table}.user_id
      WHERE users.username_normalized = ? OR users.minecraft_username_normalized = ?
      ORDER BY CASE WHEN users.username_normalized = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(
      normalizeUsername(request.params.username),
      normalizeUsername(request.params.username),
      normalizeUsername(request.params.username),
    );
    if (!texture) throw new ApiError(404, `${type}_not_found`, `Oyuncunun yüklenmiş bir ${label} yok.`);
    reply.header('Access-Control-Allow-Origin', '*');
    const etag = `"${texture.sha256}"`;
    reply.header('Cache-Control', 'public, max-age=60, must-revalidate');
    reply.header('ETag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    const image = await readFile(path.join(skinsDir, texture.storage_key));
    return reply.type('image/png').send(image);
  }

  app.get('/skin/profile/texture/login/:username', async (request, reply) => {
    const normalizedUsername = normalizeUsername(request.params.username);
    const user = database.prepare(`
      SELECT id, username FROM users
      WHERE username_normalized = ? OR minecraft_username_normalized = ?
      ORDER BY CASE WHEN username_normalized = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(normalizedUsername, normalizedUsername, normalizedUsername);
    if (!user) return reply.code(204).send();
    const skin = database.prepare('SELECT model, updated_at FROM skins WHERE user_id = ?').get(user.id);
    const cape = database.prepare('SELECT updated_at FROM capes WHERE user_id = ?').get(user.id);
    if (!skin && !cape) return reply.code(204).send();
    const result = {};
    if (skin) {
      result.SKIN = {
        url: `${publicBaseUrl}/api/v1/profiles/${encodeURIComponent(user.username)}/skin.png`,
        metadata: { model: skin.model },
      };
    }
    if (cape) {
      result.CAPE = {
        url: `${publicBaseUrl}/api/v1/profiles/${encodeURIComponent(user.username)}/cape.png`,
      };
    }
    return reply.send(result);
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

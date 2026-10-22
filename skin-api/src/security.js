import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { promisify } from 'node:util';
import { ApiError } from './errors.js';

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

export function validateUsername(username) {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

export function validateEmail(email) {
  return typeof email === 'string'
    && Buffer.byteLength(email, 'utf8') <= 254
    && EMAIL_PATTERN.test(email.trim());
}

export function normalizeUsername(username) {
  return username.toLowerCase();
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function validatePassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && Buffer.byteLength(password, 'utf8') <= 128;
}

export async function hashPassword(password) {
  return {
    salt: '',
    hash: await argon2.hash(password, ARGON2_OPTIONS),
    algorithm: 'argon2id',
  };
}

export async function verifyPassword(password, { algorithm, salt, hash }) {
  if (algorithm === 'argon2id' || hash.startsWith('$argon2id$')) {
    return argon2.verify(hash, password);
  }
  if (algorithm !== 'scrypt') return false;

  const derived = Buffer.from(await scrypt(password, salt, 64, SCRYPT_OPTIONS));
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function createId() {
  return randomUUID();
}

export function createOpaqueToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function parseBearerToken(header) {
  const match = typeof header === 'string' && /^Bearer ([A-Za-z0-9_-]{40,50})$/.exec(header);
  if (!match) throw new ApiError(401, 'unauthorized', 'Geçerli bir bearer token gerekli.');
  return match[1];
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ApiError } from './errors.js';

export const MAX_SKIN_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function validateSkinPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length || buffer.length > MAX_SKIN_BYTES) {
    throw new ApiError(413, 'invalid_skin_size', 'Skin PNG dosyası boş olamaz ve 1 MiB sınırını aşamaz.');
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ApiError(415, 'invalid_skin_format', 'Dosya geçerli bir PNG skin olmalıdır.');
  }

  let metadata;
  let normalized;
  try {
    const image = sharp(buffer, { limitInputPixels: 4096, failOn: 'error' });
    metadata = await image.metadata();
    if (metadata.format !== 'png'
      || metadata.pages !== undefined && metadata.pages !== 1
      || !((metadata.width === 64 && metadata.height === 64)
        || (metadata.width === 64 && metadata.height === 32))) {
      throw new ApiError(422, 'invalid_skin_dimensions', 'Skin ölçüsü 64x64 veya 64x32 piksel olmalıdır.');
    }
    normalized = await sharp(buffer, { limitInputPixels: 4096, failOn: 'error' }).png().toBuffer();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(415, 'invalid_skin_image', 'PNG dosyası bozuk veya okunamıyor.');
  }
  if (normalized.length > MAX_SKIN_BYTES) {
    throw new ApiError(413, 'invalid_skin_size', 'İşlenmiş skin PNG dosyası 1 MiB sınırını aşıyor.');
  }
  return { buffer: normalized, sha256: createHash('sha256').update(normalized).digest('hex') };
}

export async function persistSkin({ userId, model, image, skinsDir, database, logger, replace }) {
  const storageKey = path.posix.join(userId, `${randomUUID()}.png`);
  const destination = path.join(skinsDir, storageKey);
  const temporary = `${destination}.tmp`;
  await mkdir(path.dirname(destination), { recursive: true });
  let previous;
  try {
    await writeFile(temporary, image.buffer, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
    previous = database.transaction(() => {
      const current = database.prepare('SELECT storage_key FROM skins WHERE user_id = ?').get(userId);
      if (replace && !current) {
        throw new ApiError(404, 'skin_not_found', 'Değiştirilecek bir skin bulunamadı.');
      }
      if (!replace && current) {
        throw new ApiError(409, 'skin_exists', 'Skin zaten mevcut; değiştirmek için PUT kullanın.');
      }
      database.prepare(`
        INSERT INTO skins (user_id, storage_key, model, sha256, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          storage_key = excluded.storage_key,
          model = excluded.model,
          sha256 = excluded.sha256,
          updated_at = excluded.updated_at
      `).run(userId, storageKey, model, image.sha256, new Date().toISOString());
      return current;
    })();
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(destination, { force: true });
    throw error;
  }

  if (previous && previous.storage_key !== storageKey) {
    try {
      await rm(path.join(skinsDir, previous.storage_key), { force: true });
    } catch (error) {
      logger.error({ err: error }, 'Could not remove replaced skin file');
    }
  }
  return database.prepare('SELECT user_id, storage_key, model, sha256, updated_at FROM skins WHERE user_id = ?')
    .get(userId);
}

export async function removeSkinFile(skinsDir, storageKey, logger) {
  try {
    await rm(path.join(skinsDir, storageKey), { force: true });
  } catch (error) {
    logger.error({ err: error }, 'Could not remove skin file');
  }
}

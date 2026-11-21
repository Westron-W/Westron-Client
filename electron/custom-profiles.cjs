const path = require('node:path');

const CUSTOM_PROFILE_LOADERS = new Set(['vanilla', 'fabric', 'forge']);
const MIN_CUSTOM_PROFILE_MEMORY_MB = 1024;
const MAX_CUSTOM_PROFILE_MEMORY_MB = 65536;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateCustomProfileFields(input, maxMemoryMb = MAX_CUSTOM_PROFILE_MEMORY_MB) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Özel profil bilgileri geçersiz.');
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 40) {
    throw new Error('Profil adı 1-40 karakter arasında olmalı.');
  }
  if (typeof input.gameVersion !== 'string' || !input.gameVersion.trim() || input.gameVersion.length > 64) {
    throw new Error('Minecraft sürümü geçersiz.');
  }
  if (!CUSTOM_PROFILE_LOADERS.has(input.loader)) {
    throw new Error('Mod yükleyicisi geçersiz.');
  }
  if (!Number.isSafeInteger(input.memoryMb)
    || input.memoryMb < MIN_CUSTOM_PROFILE_MEMORY_MB
    || input.memoryMb > Math.min(maxMemoryMb, MAX_CUSTOM_PROFILE_MEMORY_MB)) {
    throw new Error(`RAM miktarı ${MIN_CUSTOM_PROFILE_MEMORY_MB} MB ile ${Math.min(maxMemoryMb, MAX_CUSTOM_PROFILE_MEMORY_MB)} MB arasında olmalı.`);
  }

  const directory = typeof input.directory === 'string' ? input.directory.trim() : '';
  if (directory && !path.isAbsolute(directory)) {
    throw new Error('Profil klasörü için tam bir dosya konumu seçin.');
  }

  return {
    name,
    gameVersion: input.gameVersion,
    loader: input.loader,
    memoryMb: input.memoryMb,
    directory: directory ? path.resolve(directory) : '',
  };
}

function normalizeCustomProfiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('Özel profillerin kayıt biçimi geçersiz.');
  }

  const ids = new Set();
  const directories = new Set();
  return value.map((profile) => {
    if (!profile || typeof profile.id !== 'string' || !PROFILE_ID_PATTERN.test(profile.id)) {
      throw new Error('Özel profil kimliği geçersiz.');
    }
    if (ids.has(profile.id)) {
      throw new Error('Aynı kimliğe sahip birden fazla özel profil var.');
    }
    ids.add(profile.id);

    const fields = validateCustomProfileFields(profile);
    if (!fields.directory) {
      throw new Error('Özel profil klasörü kayıtlı değil.');
    }
    const directoryKey = process.platform === 'win32' ? fields.directory.toLowerCase() : fields.directory;
    if (directories.has(directoryKey)) {
      throw new Error('Birden fazla özel profil aynı klasörü kullanamaz.');
    }
    directories.add(directoryKey);
    return { id: profile.id, ...fields };
  });
}

function assertUniqueCustomProfileDirectory(directory, profiles, exceptId) {
  const resolvedDirectory = path.resolve(directory);
  const directoryKey = process.platform === 'win32' ? resolvedDirectory.toLowerCase() : resolvedDirectory;
  for (const profile of profiles) {
    if (profile.id === exceptId) continue;
    const existingDirectory = path.resolve(profile.directory);
    const existingKey = process.platform === 'win32' ? existingDirectory.toLowerCase() : existingDirectory;
    if (directoryKey === existingKey) {
      throw new Error('Birden fazla özel profil aynı klasörü kullanamaz.');
    }
  }
}

function isWithinDirectory(parent, candidate) {
  const relativePath = path.relative(parent, candidate);
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

function assertSafeCustomProfileDeletion(directory, { homeDirectory, minecraftDir, profiles, profileId }) {
  const resolvedDirectory = path.resolve(directory);
  if (resolvedDirectory === path.parse(resolvedDirectory).root) {
    throw new Error('Bu klasör güvenli şekilde silinemez; başka bir profil veya önemli klasörle çakışıyor.');
  }

  const protectedDirectories = [homeDirectory, minecraftDir, path.join(minecraftDir, 'westron-profiles')]
    .map((protectedDirectory) => path.resolve(protectedDirectory));
  if (protectedDirectories.some((protectedDirectory) =>
    resolvedDirectory === protectedDirectory || isWithinDirectory(resolvedDirectory, protectedDirectory))) {
    throw new Error('Bu klasör güvenli şekilde silinemez; başka bir profil veya önemli klasörle çakışıyor.');
  }

  for (const profile of profiles) {
    if (profile.id === profileId) continue;
    const otherDirectory = path.resolve(profile.directory);
    if (isWithinDirectory(resolvedDirectory, otherDirectory)
      || isWithinDirectory(otherDirectory, resolvedDirectory)) {
      throw new Error('Bu klasör güvenli şekilde silinemez; başka bir profil veya önemli klasörle çakışıyor.');
    }
  }
}

module.exports = {
  MAX_CUSTOM_PROFILE_MEMORY_MB,
  MIN_CUSTOM_PROFILE_MEMORY_MB,
  assertSafeCustomProfileDeletion,
  assertUniqueCustomProfileDirectory,
  normalizeCustomProfiles,
  validateCustomProfileFields,
};

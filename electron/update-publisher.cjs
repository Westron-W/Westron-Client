const fs = require('node:fs/promises');
const path = require('node:path');
const MIN_UPDATE_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_UPDATE_UPLOAD_TIMEOUT_MS = 90 * 60 * 1000;
const UPDATE_UPLOAD_BYTES_PER_SECOND = 64 * 1024;
const UPDATE_UPLOAD_GRACE_MS = 3 * 60 * 1000;

function getUpdateUploadTimeoutMs(fileSizeBytes) {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error('Güncelleme dosyası boyutu geçersiz.');
  }
  const estimatedMs = UPDATE_UPLOAD_GRACE_MS
    + Math.ceil((fileSizeBytes / UPDATE_UPLOAD_BYTES_PER_SECOND) * 1000);
  return Math.min(MAX_UPDATE_UPLOAD_TIMEOUT_MS, Math.max(MIN_UPDATE_UPLOAD_TIMEOUT_MS, estimatedMs));
}

async function readIfPresent(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readUpdateFiles(directory) {
  const installerName = 'Westron Client Setup 1.0.exe';
  const blockmapName = 'Westron Client Setup 1.0.exe.blockmap';
  const [installerContents, blockmapContents, manifestContents] = await Promise.all([
    readIfPresent(path.join(directory, installerName)),
    readIfPresent(path.join(directory, blockmapName)),
    readIfPresent(path.join(directory, 'latest.yml')),
  ]);
  const missingFiles = [];
  if (!installerContents) missingFiles.push(installerName);
  if (!blockmapContents) missingFiles.push(blockmapName);
  if (!manifestContents) missingFiles.push('latest.yml');
  if (missingFiles.length > 0) {
    throw new MissingUpdateFilesError(
      `Seçilen klasörde ${missingFiles.join(' ve ')} bulunamadı. `
      + 'Lütfen npm run package komutuyla oluşturulan ve bu üç dosyanın birlikte bulunduğu release klasörünü seçin.',
    );
  }
  return {
    installer: { name: installerName, contents: installerContents },
    blockmap: { name: blockmapName, contents: blockmapContents },
    manifest: { name: 'latest.yml', contents: manifestContents },
  };
}

class MissingUpdateFilesError extends Error {}

module.exports = { MissingUpdateFilesError, getUpdateUploadTimeoutMs, readUpdateFiles };

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const packageJson = require('../package.json');
const MAX_UPDATE_FILE_BYTES = 256 * 1024 * 1024;

async function readIfPresent(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error(`${path.basename(filePath)} normal bir dosya değil.`);
    if (stats.size > MAX_UPDATE_FILE_BYTES) {
      throw new Error(`${path.basename(filePath)} 256 MiB yayın sınırını aşıyor.`);
    }
    const contents = await fs.readFile(filePath);
    if (contents.length > MAX_UPDATE_FILE_BYTES) {
      throw new Error(`${path.basename(filePath)} 256 MiB yayın sınırını aşıyor.`);
    }
    return contents;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function createUpdateManifest(installerName, installerContents) {
  const sha512 = createHash('sha512').update(installerContents).digest('base64');
  return Buffer.from([
    `version: ${packageJson.version}`,
    'files:',
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${installerContents.length}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n'));
}

async function readUpdateFiles(directory) {
  const installerName = `Westron-Client-Setup-${packageJson.version}.exe`;
  const blockmapName = `${installerName}.blockmap`;
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
  if (installerContents.length === 0 || blockmapContents.length === 0) {
    throw new Error('Kurulum dosyası veya blockmap boş; bu klasörden güncelleme yayımlanamaz.');
  }
  const manifest = manifestContents.toString('utf8');
  const version = manifest.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const fileName = manifest.match(/^  - url:\s*(Westron-Client-Setup-\d+\.\d+\.\d+\.exe)\s*$/m)?.[1];
  const sha512 = manifest.match(/^    sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  const actualHash = createHash('sha512').update(installerContents).digest('base64');
  const verifiedManifest = version === packageJson.version
    && fileName === installerName
    && actualHash === sha512
    ? manifestContents
    : createUpdateManifest(installerName, installerContents);
  return {
    installer: { name: installerName, contents: installerContents },
    blockmap: { name: blockmapName, contents: blockmapContents },
    manifest: { name: 'latest.yml', contents: verifiedManifest },
  };
}

class MissingUpdateFilesError extends Error {}

module.exports = { MAX_UPDATE_FILE_BYTES, MissingUpdateFilesError, readUpdateFiles };

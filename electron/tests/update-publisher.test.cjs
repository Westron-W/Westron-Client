const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MAX_UPDATE_FILE_BYTES, readUpdateFiles } = require('../update-publisher.cjs');

test('reads the installer and both update sidecars from a release directory', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const installerContents = Buffer.from('installer');
  const blockmapContents = Buffer.from('blockmap');
  const hash = createHash('sha512').update(installerContents).digest('base64');
  const manifestContents = Buffer.from([
    'version: 1.0.2',
    'files:',
    '  - url: Westron-Client-Setup-1.0.2.exe',
    `    sha512: ${hash}`,
    `    size: ${installerContents.length}`,
    'path: Westron-Client-Setup-1.0.2.exe',
    `sha512: ${hash}`,
    '',
  ].join('\n'));
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe'), installerContents);
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe.blockmap'), blockmapContents);
  await fs.writeFile(path.join(directory, 'latest.yml'), manifestContents);

  const result = await readUpdateFiles(directory);

  assert.deepEqual(result.installer.contents, installerContents);
  assert.deepEqual(result.blockmap.contents, blockmapContents);
  assert.deepEqual(result.manifest.contents, manifestContents);
});

test('rebuilds stale release metadata from the versioned installer and its actual hash', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-stale-manifest-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const installerContents = Buffer.from('current installer');
  const staleManifest = Buffer.from([
    'version: 1.0.1',
    'files:',
    '  - url: Westron-Client-Setup-1.0.1.exe',
    '    sha512: stale',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe'), installerContents);
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe.blockmap'), 'current blockmap');
  await fs.writeFile(path.join(directory, 'latest.yml'), staleManifest);

  const result = await readUpdateFiles(directory);
  const generatedManifest = result.manifest.contents.toString('utf8');
  const installerHash = createHash('sha512').update(installerContents).digest('base64');

  assert.match(generatedManifest, /^version: 1\.0\.2$/m);
  assert.match(generatedManifest, /^  - url: Westron-Client-Setup-1\.0\.2\.exe$/m);
  assert.ok(generatedManifest.split('\n').includes(`    sha512: ${installerHash}`));
  assert.match(generatedManifest, new RegExp(`^    size: ${installerContents.length}$`, 'm'));
  assert.notDeepEqual(result.manifest.contents, staleManifest);
});

test('rejects a release with an empty blockmap', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-empty-blockmap-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const installerContents = Buffer.from('installer');
  const hash = createHash('sha512').update(installerContents).digest('base64');
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe'), installerContents);
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe.blockmap'), '');
  await fs.writeFile(path.join(directory, 'latest.yml'), [
    'version: 1.0.2',
    'files:',
    '  - url: Westron-Client-Setup-1.0.2.exe',
    `    sha512: ${hash}`,
    '',
  ].join('\n'));

  await assert.rejects(readUpdateFiles(directory), /Kurulum dosyası veya blockmap boş/i);
});

test('rejects update files that exceed the server upload limit before reading them', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-oversized-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const installerPath = path.join(directory, 'Westron-Client-Setup-1.0.2.exe');
  await fs.writeFile(installerPath, '');
  await fs.truncate(installerPath, MAX_UPDATE_FILE_BYTES + 1);

  await assert.rejects(readUpdateFiles(directory), /256 MiB yayın sınırını aşıyor/i);
});

test('rejects a standalone installer folder and explains which files the release needs', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-installer-only-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe'), 'installer');

  await assert.rejects(
    readUpdateFiles(directory),
    (error) => error.message.includes('Westron-Client-Setup-1.0.2.exe.blockmap')
      && error.message.includes('latest.yml')
      && error.message.includes('release klasörünü seçin'),
  );
});

test('reports all missing release artifacts with actionable instructions', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-empty-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    readUpdateFiles(directory),
    (error) => error.message.includes('Westron-Client-Setup-1.0.2.exe')
      && error.message.includes('Westron-Client-Setup-1.0.2.exe.blockmap')
      && error.message.includes('latest.yml')
      && error.message.includes('release klasörünü seçin'),
  );
});

test('reports only the missing release artifact', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-partial-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'Westron-Client-Setup-1.0.2.exe'), 'installer');
  await fs.writeFile(path.join(directory, 'latest.yml'), 'version: 1.0.6\n');

  await assert.rejects(
    readUpdateFiles(directory),
    (error) => error.message === 'Seçilen klasörde Westron-Client-Setup-1.0.2.exe.blockmap bulunamadı. '
      + 'Lütfen npm run package komutuyla oluşturulan ve bu üç dosyanın birlikte bulunduğu release klasörünü seçin.',
  );
});

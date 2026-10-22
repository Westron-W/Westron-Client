const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getUpdateUploadTimeoutMs, readUpdateFiles } = require('../update-publisher.cjs');

test('gives large update uploads a size-aware timeout capped for slow links', () => {
  assert.equal(getUpdateUploadTimeoutMs(0), 5 * 60 * 1000);
  assert.equal(getUpdateUploadTimeoutMs(1024 * 1024), 5 * 60 * 1000);
  assert.equal(getUpdateUploadTimeoutMs(116 * 1024 * 1024), 33 * 60 * 1000 + 56 * 1000);
  assert.equal(getUpdateUploadTimeoutMs(256 * 1024 * 1024), 71 * 60 * 1000 + 16 * 1000);
  assert.equal(getUpdateUploadTimeoutMs(1024 * 1024 * 1024), 90 * 60 * 1000);
  assert.throws(() => getUpdateUploadTimeoutMs(-1), /boyutu geçersiz/);
});

test('reads the installer and both update sidecars from a release directory', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const installerContents = Buffer.from('installer');
  const blockmapContents = Buffer.from('blockmap');
  const manifestContents = Buffer.from('version: 1.0.6\n');
  await fs.writeFile(path.join(directory, 'Westron Client Setup 1.0.exe'), installerContents);
  await fs.writeFile(path.join(directory, 'Westron Client Setup 1.0.exe.blockmap'), blockmapContents);
  await fs.writeFile(path.join(directory, 'latest.yml'), manifestContents);

  const result = await readUpdateFiles(directory);

  assert.deepEqual(result.installer.contents, installerContents);
  assert.deepEqual(result.blockmap.contents, blockmapContents);
  assert.deepEqual(result.manifest.contents, manifestContents);
});

test('rejects a standalone installer folder and explains which files the release needs', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-installer-only-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'Westron Client Setup 1.0.exe'), 'installer');

  await assert.rejects(
    readUpdateFiles(directory),
    (error) => error.message.includes('Westron Client Setup 1.0.exe.blockmap')
      && error.message.includes('latest.yml')
      && error.message.includes('release klasörünü seçin'),
  );
});

test('reports all missing release artifacts with actionable instructions', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-empty-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    readUpdateFiles(directory),
    (error) => error.message.includes('Westron Client Setup 1.0.exe')
      && error.message.includes('Westron Client Setup 1.0.exe.blockmap')
      && error.message.includes('latest.yml')
      && error.message.includes('release klasörünü seçin'),
  );
});

test('reports only the missing release artifact', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-release-partial-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'Westron Client Setup 1.0.exe'), 'installer');
  await fs.writeFile(path.join(directory, 'latest.yml'), 'version: 1.0.6\n');

  await assert.rejects(
    readUpdateFiles(directory),
    (error) => error.message === 'Seçilen klasörde Westron Client Setup 1.0.exe.blockmap bulunamadı. '
      + 'Lütfen npm run package komutuyla oluşturulan ve bu üç dosyanın birlikte bulunduğu release klasörünü seçin.',
  );
});

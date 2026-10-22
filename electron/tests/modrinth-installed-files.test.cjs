const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  persistInstalledFiles,
  readInstallIndex,
  removeInstalledFile,
} = require('../modrinth-installed-files.cjs');

async function createTestDirectory() {
  const directory = path.join(os.tmpdir(), `westron-modrinth-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

test('tracks Modrinth updates and removes only the previously managed file', async () => {
  const directory = await createTestDirectory();
  try {
    await fs.writeFile(path.join(directory, 'old-pack.zip'), 'old');
    await fs.writeFile(path.join(directory, 'new-pack.zip'), 'new');
    await fs.writeFile(path.join(directory, 'user-pack.zip'), 'user');
    const oldIndex = { 'project-id': 'old-pack.zip' };

    await persistInstalledFiles(directory, '.zip', oldIndex, [
      { projectId: 'project-id', fileName: 'new-pack.zip' },
    ]);

    assert.deepEqual(await readInstallIndex(directory, '.zip'), {
      'project-id': 'new-pack.zip',
    });
    await assert.rejects(fs.access(path.join(directory, 'old-pack.zip')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(directory, 'new-pack.zip'), 'utf8'), 'new');
    assert.equal(await fs.readFile(path.join(directory, 'user-pack.zip'), 'utf8'), 'user');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('removes the selected file and clears its project mapping', async () => {
  const directory = await createTestDirectory();
  try {
    await fs.writeFile(path.join(directory, 'one.zip'), 'one');
    await fs.writeFile(path.join(directory, 'two.zip'), 'two');
    await persistInstalledFiles(directory, '.zip', {}, [
      { projectId: 'one', fileName: 'one.zip' },
      { projectId: 'two', fileName: 'two.zip' },
    ]);

    await removeInstalledFile(directory, '.zip', 'one.zip');

    assert.deepEqual(await readInstallIndex(directory, '.zip'), { two: 'two.zip' });
    await assert.rejects(fs.access(path.join(directory, 'one.zip')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(directory, 'two.zip'), 'utf8'), 'two');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe install-index filenames', async () => {
  const directory = await createTestDirectory();
  try {
    await assert.rejects(
      persistInstalledFiles(directory, '.jar', {}, [
        { projectId: 'project-id', fileName: '..\\outside.jar' },
      ]),
      /kurulum kaydı geçersiz/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { persistInstalledFiles, readInstallIndex } = require('../modrinth-installed-files.cjs');
const {
  forgetPerformanceProjects,
  removePerformanceManagedFiles,
  readPerformanceProfile,
  writePerformanceProfile,
} = require('../performance-profile.cjs');

async function createGameDirectory() {
  const directory = path.join(os.tmpdir(), `westron-performance-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

test('stores per-profile mode ownership and forgets manually reinstalled projects', async () => {
  const directory = await createGameDirectory();
  try {
    const profile = {
      mode: 'quality',
      includesShader: true,
      managedFiles: [
        { type: 'mod', projectId: 'sodium-project', fileName: 'sodium.jar' },
        { type: 'shader', projectId: 'shader-project', fileName: 'complementary.zip' },
      ],
    };
    await writePerformanceProfile(directory, profile);
    await forgetPerformanceProjects(directory, ['sodium-project']);

    assert.deepEqual(await readPerformanceProfile(directory), {
      ...profile,
      managedFiles: [{ type: 'shader', projectId: 'shader-project', fileName: 'complementary.zip' }],
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe performance ownership filenames', async () => {
  const directory = await createGameDirectory();
  try {
    await assert.rejects(writePerformanceProfile(directory, {
      mode: 'performance',
      includesShader: false,
      managedFiles: [{ type: 'mod', projectId: 'sodium-project', fileName: '..\\outside.jar' }],
    }), /kurulum kaydı geçersiz/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('removes only indexed files owned by the active performance profile', async () => {
  const directory = await createGameDirectory();
  const modsDirectory = path.join(directory, 'mods');
  try {
    await fs.mkdir(modsDirectory, { recursive: true });
    await fs.writeFile(path.join(modsDirectory, 'managed.jar'), 'managed');
    await fs.writeFile(path.join(modsDirectory, 'external.jar'), 'external');
    await persistInstalledFiles(modsDirectory, '.jar', {}, [
      { projectId: 'managed-project', fileName: 'managed.jar' },
    ]);

    await removePerformanceManagedFiles(directory, [
      { type: 'mod', projectId: 'managed-project', fileName: 'managed.jar' },
      { type: 'mod', projectId: 'stale-project', fileName: 'external.jar' },
    ]);

    await assert.rejects(fs.access(path.join(modsDirectory, 'managed.jar')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(modsDirectory, 'external.jar'), 'utf8'), 'external');
    assert.deepEqual(await readInstallIndex(modsDirectory, '.jar'), {});
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  getDefaultMinecraftDir,
  getWindowsMinecraftDir,
  isLegacyMinecraftDir,
  migrateLegacyMinecraftProfiles,
} = require('../minecraft-paths.cjs');

test('uses the standard Minecraft directory beneath the application data directory', () => {
  assert.equal(getDefaultMinecraftDir('C:\\Users\\Player\\AppData\\Roaming', 'win32'),
    'C:\\Users\\Player\\AppData\\Roaming\\.minecraft');
  assert.equal(getWindowsMinecraftDir('C:\\Users\\Player\\AppData\\Roaming'),
    'C:\\Users\\Player\\AppData\\Roaming\\.minecraft');
  assert.equal(getDefaultMinecraftDir('/Users/player/Library/Application Support', 'darwin'),
    '/Users/player/Library/Application Support/minecraft');
});

test('recognizes the cache-nested legacy Minecraft directory', () => {
  assert.equal(isLegacyMinecraftDir(
    'C:\\Users\\Player\\AppData\\Roaming\\westron-client\\renderer-cache-v2\\.minecraft',
    'C:\\Users\\Player\\AppData\\Roaming\\westron-client\\renderer-cache-v2',
    'win32',
  ), true);
  assert.equal(isLegacyMinecraftDir('C:\\Users\\Player\\AppData\\Roaming\\.minecraft',
    'C:\\Users\\Player\\AppData\\Roaming\\westron-client\\renderer-cache-v2', 'win32'), false);
});

test('migrates profiles and preserves files already in the standard directory', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-minecraft-paths-'));
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const source = path.join(temporaryDirectory, 'legacy', '.minecraft');
  const target = path.join(temporaryDirectory, 'Roaming', '.minecraft');
  await fs.mkdir(path.join(source, 'westron-profiles', '26.3'), { recursive: true });
  await fs.mkdir(path.join(target, 'westron-profiles', 'existing'), { recursive: true });
  await fs.writeFile(path.join(source, 'westron-profiles', '26.3', 'profile.json'), 'legacy');
  await fs.writeFile(path.join(target, 'westron-profiles', 'existing', 'profile.json'), 'existing');

  await migrateLegacyMinecraftProfiles(source, target);

  assert.equal(await fs.readFile(path.join(target, 'westron-profiles', '26.3', 'profile.json'), 'utf8'), 'legacy');
  assert.equal(await fs.readFile(path.join(target, 'westron-profiles', 'existing', 'profile.json'), 'utf8'), 'existing');
});

test('does nothing when the legacy and standard Minecraft directories are the same', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-minecraft-paths-'));
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporaryDirectory, 'westron-profiles'), { recursive: true });

  await assert.doesNotReject(() => migrateLegacyMinecraftProfiles(temporaryDirectory, temporaryDirectory));
});

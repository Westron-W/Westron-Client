const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertSafeCustomProfileDeletion,
  assertUniqueCustomProfileDirectory,
  normalizeCustomProfiles,
  validateCustomProfileFields,
} = require('../custom-profiles.cjs');

const profileId = 'c6401c4d-8a8b-4bf8-9d6d-90f408e8dd84';
const secondProfileId = 'e64d8278-d8a2-459b-af14-7b6fc170c163';

test('validates custom profile settings and allows the default folder to be omitted', () => {
  assert.deepEqual(validateCustomProfileFields({
    name: '  Test profile  ',
    gameVersion: '1.21.4',
    loader: 'fabric',
    memoryMb: 4096,
  }), {
    name: 'Test profile',
    gameVersion: '1.21.4',
    loader: 'fabric',
    memoryMb: 4096,
    directory: '',
  });

  assert.throws(() => validateCustomProfileFields({
    name: 'Invalid RAM',
    gameVersion: '1.21.4',
    loader: 'fabric',
    memoryMb: 8192,
  }, 4096), /RAM miktarı/);
  assert.throws(() => validateCustomProfileFields({
    name: 'Relative folder',
    gameVersion: '1.21.4',
    loader: 'fabric',
    memoryMb: 2048,
    directory: 'relative\\profile',
  }), /tam bir dosya konumu/);
  assert.throws(() => validateCustomProfileFields({
    name: 'Missing version',
    gameVersion: '',
    loader: 'fabric',
    memoryMb: 2048,
  }), /Minecraft sürümü/);
});

test('normalizes stored profiles and rejects duplicate profile folders', () => {
  const directory = path.join(os.tmpdir(), 'westron-custom-profile');
  const profiles = normalizeCustomProfiles([
    {
      id: profileId,
      name: 'Test',
      gameVersion: '1.21.4',
      loader: 'vanilla',
      memoryMb: 2048,
      directory,
    },
  ]);
  assert.equal(profiles[0].directory, path.resolve(directory));
  assert.throws(() => normalizeCustomProfiles([
    ...profiles,
    { ...profiles[0], id: secondProfileId, name: 'Duplicate folder' },
  ]), /aynı klasörü/);
});

test('prevents assigning a folder that another custom profile already uses', () => {
  const directory = path.join(os.tmpdir(), 'westron-custom-profile');
  assert.throws(() => assertUniqueCustomProfileDirectory(directory, [{
    id: profileId,
    directory,
  }], secondProfileId), /aynı klasörü/);
  assert.doesNotThrow(() => assertUniqueCustomProfileDirectory(directory, [{
    id: profileId,
    directory,
  }], profileId));
});

test('allows deleting a dedicated custom folder but protects home, Minecraft, and overlapping profiles', () => {
  const homeDirectory = path.join(os.tmpdir(), 'westron-home');
  const minecraftDir = path.join(homeDirectory, 'AppData', 'Roaming', '.minecraft');
  const profileDirectory = path.join(minecraftDir, 'westron-profiles', 'custom', profileId);
  const options = { homeDirectory, minecraftDir, profiles: [], profileId };

  assert.doesNotThrow(() => assertSafeCustomProfileDeletion(profileDirectory, options));
  assert.throws(() => assertSafeCustomProfileDeletion(homeDirectory, options), /güvenli şekilde silinemez/);
  assert.throws(() => assertSafeCustomProfileDeletion(minecraftDir, options), /güvenli şekilde silinemez/);
  assert.throws(() => assertSafeCustomProfileDeletion(path.dirname(profileDirectory), {
    ...options,
    profiles: [{ id: secondProfileId, directory: path.join(profileDirectory, 'other') }],
  }), /güvenli şekilde silinemez/);
});

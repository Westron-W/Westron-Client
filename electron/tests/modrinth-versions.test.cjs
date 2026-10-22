const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCompatibleVersion,
  ModCompatibilityError,
  selectCompatibleVersions,
  selectCompatibleVersion,
  selectInstallableVersion,
  resolveDependencyVersion,
} = require('../modrinth-versions.cjs');

const compatibleVersion = {
  id: 'fabric-26.3',
  project_id: 'dependency-project',
  game_versions: ['26.3'],
  loaders: ['fabric'],
};

test('filters versions by both Minecraft version and loader', () => {
  const versions = [
    { ...compatibleVersion, id: 'wrong-game', game_versions: ['26.2'] },
    { ...compatibleVersion, id: 'wrong-loader', loaders: ['forge'] },
    compatibleVersion,
  ];

  assert.equal(selectCompatibleVersion(versions, '26.3', 'fabric'), compatibleVersion);
  assert.equal(isCompatibleVersion(versions[0], '26.3', 'fabric'), false);
});

test('selects the newest compatible version instead of relying on API response order', () => {
  const newest = {
    ...compatibleVersion,
    id: 'newest',
    version_number: '2.0.0',
    date_published: '2026-10-01T00:00:00Z',
  };
  const older = {
    ...compatibleVersion,
    id: 'older',
    version_number: '1.9.0',
    date_published: '2026-09-01T00:00:00Z',
  };
  const incompatible = {
    ...newest,
    id: 'wrong-game',
    game_versions: ['26.2'],
    date_published: '2026-10-10T00:00:00Z',
  };

  assert.equal(selectCompatibleVersion([older, incompatible, newest], '26.3', 'fabric'), newest);
});

test('falls back to an older compatible mod when the newest release has an incompatible required dependency', async () => {
  const newest = {
    ...compatibleVersion,
    id: 'zoomify-latest',
    project_id: 'zoomify',
    version_number: '2.17.0+mc26.3',
    date_published: '2026-10-08T12:59:28Z',
  };
  const older = {
    ...newest,
    id: 'zoomify-compatible',
    version_number: '2.16.3+26.3',
    date_published: '2026-10-01T12:00:00Z',
  };
  const result = await selectInstallableVersion(
    [older, newest],
    '26.3',
    'fabric',
    async (version) => {
      if (version === newest) throw new ModCompatibilityError('Required dependency is not available for Fabric.');
      return ['fabric-api', 'yacl', 'zoomify'];
    },
  );

  assert.equal(result.version, older);
  assert.deepEqual(result.plan, ['fabric-api', 'yacl', 'zoomify']);
});

test('does not hide network or unexpected errors while trying compatible versions', async () => {
  await assert.rejects(
    selectInstallableVersion([compatibleVersion], '26.3', 'fabric', async () => {
      throw new Error('Modrinth request failed');
    }),
    /Modrinth request failed/,
  );
});

test('selects compatible resource and shader versions without a Fabric loader filter', () => {
  const versions = [
    { id: 'wrong-game', game_versions: ['26.2'], date_published: '2026-10-10T00:00:00Z' },
    { id: 'newest', game_versions: ['26.3'], date_published: '2026-10-01T00:00:00Z' },
    { id: 'older', game_versions: ['26.3'], date_published: '2026-09-01T00:00:00Z' },
  ];

  assert.equal(selectCompatibleVersion(versions, '26.3'), versions[1]);
});

test('keeps a pinned version when it matches the installed game and loader', async () => {
  const result = await resolveDependencyVersion({ version_id: 'pinned' }, {
    gameVersion: '26.3',
    loader: 'fabric',
    getVersionById: async () => compatibleVersion,
    getCompatibleVersion: async () => {
      throw new Error('Must not request a fallback version');
    },
  });

  assert.equal(result, compatibleVersion);
});

test('falls back to the project compatible version for an incompatible pinned dependency', async () => {
  const incompatible = {
    ...compatibleVersion,
    id: 'pinned',
    game_versions: ['26.2'],
  };
  const result = await resolveDependencyVersion({
    project_id: 'dependency-project',
    version_id: 'pinned',
  }, {
    gameVersion: '26.3',
    loader: 'fabric',
    getVersionById: async () => incompatible,
    getCompatibleVersion: async (projectId) => {
      assert.equal(projectId, 'dependency-project');
      return compatibleVersion;
    },
  });

  assert.equal(result, compatibleVersion);
});

test('falls back when a pinned version was removed but its project remains available', async () => {
  const result = await resolveDependencyVersion({
    project_id: 'dependency-project',
    version_id: 'deleted-version',
  }, {
    gameVersion: '26.3',
    loader: 'fabric',
    getVersionById: async () => null,
    getCompatibleVersion: async () => compatibleVersion,
  });

  assert.equal(result, compatibleVersion);
});

test('reports a clear compatibility error when no fallback exists', async () => {
  await assert.rejects(
    resolveDependencyVersion({
      project_id: 'dependency-project',
      version_id: 'pinned',
    }, {
      gameVersion: '26.3',
      loader: 'fabric',
      dependencyLabel: 'Required Lib',
      getVersionById: async () => ({
        ...compatibleVersion,
        game_versions: ['26.2'],
      }),
      getCompatibleVersion: async () => null,
    }),
    /"Required Lib".*Minecraft 26\.3.*fabric/,
  );
});

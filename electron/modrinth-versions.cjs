function isCompatibleVersion(version, gameVersion, loader) {
  return Boolean(version
    && Array.isArray(version.game_versions)
    && version.game_versions.includes(gameVersion)
    && (loader === undefined
      || (Array.isArray(version.loaders) && version.loaders.includes(loader))));
}

class ModCompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModCompatibilityError';
  }
}

function selectCompatibleVersions(versions, gameVersion, loader) {
  if (!Array.isArray(versions)) return null;
  return versions
    .filter((version) => isCompatibleVersion(version, gameVersion, loader))
    .sort((a, b) => {
      const aPublished = Date.parse(a.date_published ?? '');
      const bPublished = Date.parse(b.date_published ?? '');
      if (Number.isFinite(aPublished) && Number.isFinite(bPublished) && aPublished !== bPublished) {
        return bPublished - aPublished;
      }
      if (Number.isFinite(aPublished) !== Number.isFinite(bPublished)) {
        return Number.isFinite(bPublished) ? 1 : -1;
      }
      return String(b.version_number ?? '').localeCompare(String(a.version_number ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
}

function selectCompatibleVersion(versions, gameVersion, loader) {
  return selectCompatibleVersions(versions, gameVersion, loader)?.[0] ?? null;
}

async function selectInstallableVersion(versions, gameVersion, loader, resolveInstallPlan) {
  let lastCompatibilityError = null;
  for (const version of selectCompatibleVersions(versions, gameVersion, loader) ?? []) {
    try {
      return { version, plan: await resolveInstallPlan(version) };
    } catch (error) {
      if (!(error instanceof ModCompatibilityError)) throw error;
      lastCompatibilityError = error;
    }
  }
  if (lastCompatibilityError) throw lastCompatibilityError;
  return null;
}

async function resolveDependencyVersion(dependency, {
  gameVersion,
  loader,
  dependencyLabel,
  getVersionById,
  getCompatibleVersion,
}) {
  let pinnedVersion = null;
  if (dependency.version_id) {
    pinnedVersion = await getVersionById(dependency.version_id);
    if (pinnedVersion && isCompatibleVersion(pinnedVersion, gameVersion, loader)) {
      return pinnedVersion;
    }
  }

  const projectId = dependency.project_id || pinnedVersion?.project_id;
  if (projectId) {
    const compatibleVersion = await getCompatibleVersion(projectId);
    if (isCompatibleVersion(compatibleVersion, gameVersion, loader)) {
      return compatibleVersion;
    }
  }

  const label = dependencyLabel || pinnedVersion?.name || dependency.project_id || dependency.version_id || 'Mod';
  throw new ModCompatibilityError(
    `"${label}" bağımlılığı için Minecraft ${gameVersion} ve ${loader} ile uyumlu bir sürüm bulunamadı.`,
  );
}

module.exports = {
  ModCompatibilityError,
  isCompatibleVersion,
  selectCompatibleVersions,
  selectCompatibleVersion,
  selectInstallableVersion,
  resolveDependencyVersion,
};

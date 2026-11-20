const fs = require('node:fs/promises');
const path = require('node:path');

function getDefaultMinecraftDir(appDataDirectory, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.join(appDataDirectory, platform === 'darwin' ? 'minecraft' : '.minecraft');
}

function getWindowsMinecraftDir(appDataDirectory) {
  return path.win32.join(appDataDirectory, '.minecraft');
}

function isLegacyMinecraftDir(minecraftDir, cacheDirectory, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const savedPath = pathApi.resolve(minecraftDir);
  const legacyPath = pathApi.resolve(cacheDirectory, '.minecraft');
  return platform === 'win32'
    ? savedPath.toLowerCase() === legacyPath.toLowerCase()
    : savedPath === legacyPath;
}

async function migrateLegacyMinecraftProfiles(sourceMinecraftDir, targetMinecraftDir) {
  const pathApi = process.platform === 'win32' ? path.win32 : path.posix;
  const sourceRoot = pathApi.resolve(sourceMinecraftDir);
  const targetRoot = pathApi.resolve(targetMinecraftDir);
  const rootsMatch = process.platform === 'win32'
    ? sourceRoot.toLowerCase() === targetRoot.toLowerCase()
    : sourceRoot === targetRoot;
  if (rootsMatch) return;

  const source = path.join(sourceMinecraftDir, 'westron-profiles');
  const target = path.join(targetMinecraftDir, 'westron-profiles');
  try {
    await fs.access(source);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  await fs.mkdir(targetMinecraftDir, { recursive: true });
  try {
    await fs.access(target);
    await fs.cp(source, target, { recursive: true, force: false });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.rename(source, target);
  }
}

module.exports = {
  getDefaultMinecraftDir,
  getWindowsMinecraftDir,
  isLegacyMinecraftDir,
  migrateLegacyMinecraftProfiles,
};

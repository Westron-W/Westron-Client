const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { removeInstalledProject } = require('./modrinth-installed-files.cjs');

const PROFILE_FILE = '.westron-performance-profile.json';
const MODES = new Set(['default', 'performance', 'quality']);

function defaultPerformanceProfile() {
  return { mode: 'default', includesShader: false, managedFiles: [] };
}

function validatePerformanceProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)
    || !MODES.has(profile.mode)
    || typeof profile.includesShader !== 'boolean'
    || !Array.isArray(profile.managedFiles)) {
    throw new Error('Westron Launcher modu kurulum kaydı geçersiz.');
  }
  const keys = new Set();
  for (const file of profile.managedFiles) {
    const extension = file?.type === 'mod' ? '.jar' : file?.type === 'shader' ? '.zip' : '';
    const key = `${file?.type}:${file?.projectId}`;
    if (!extension
      || typeof file.projectId !== 'string'
      || !/^[a-zA-Z0-9_-]+$/.test(file.projectId)
      || typeof file.fileName !== 'string'
      || path.basename(file.fileName) !== file.fileName
      || !file.fileName.toLowerCase().endsWith(extension)
      || keys.has(key)) {
      throw new Error('Westron Launcher modu kurulum kaydı geçersiz.');
    }
    keys.add(key);
  }
  return profile;
}

async function readPerformanceProfile(gameDirectory) {
  let contents;
  try {
    contents = await fs.readFile(path.join(gameDirectory, PROFILE_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return defaultPerformanceProfile();
    throw error;
  }
  let profile;
  try {
    profile = JSON.parse(contents);
  } catch {
    throw new Error('Westron Launcher modu kurulum kaydı okunamadı.');
  }
  return validatePerformanceProfile(profile);
}

async function writePerformanceProfile(gameDirectory, profile) {
  const validProfile = validatePerformanceProfile(profile);
  const profilePath = path.join(gameDirectory, PROFILE_FILE);
  const temporaryPath = `${profilePath}.${randomUUID()}.tmp`;
  await fs.mkdir(gameDirectory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(validProfile, null, 2), { flag: 'wx' });
    await fs.rename(temporaryPath, profilePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function forgetPerformanceProjects(gameDirectory, projectIds, type = 'mod') {
  if (!Array.isArray(projectIds) || !['mod', 'shader'].includes(type)
    || projectIds.some((projectId) => typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId))) {
    throw new Error('Westron Launcher modu kurulum kaydı güncelleme isteği geçersiz.');
  }
  const forgotten = new Set(projectIds);
  const profile = await readPerformanceProfile(gameDirectory);
  const managedFiles = profile.managedFiles.filter((file) => file.type !== type || !forgotten.has(file.projectId));
  if (managedFiles.length !== profile.managedFiles.length) {
    await writePerformanceProfile(gameDirectory, { ...profile, managedFiles });
  }
}

async function removePerformanceManagedFiles(gameDirectory, managedFiles) {
  validatePerformanceProfile({ mode: 'default', includesShader: false, managedFiles });
  for (const file of managedFiles) {
    const directory = path.join(gameDirectory, file.type === 'mod' ? 'mods' : 'shaderpacks');
    await removeInstalledProject(directory, file.type === 'mod' ? '.jar' : '.zip', file.projectId, file.fileName);
  }
}

module.exports = {
  defaultPerformanceProfile,
  forgetPerformanceProjects,
  removePerformanceManagedFiles,
  readPerformanceProfile,
  validatePerformanceProfile,
  writePerformanceProfile,
};

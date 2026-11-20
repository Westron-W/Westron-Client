const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function getIndexPath(directory) {
  return path.join(directory, '.westron-modrinth-installs.json');
}

function validateInstallIndex(index, extension) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error('Modrinth kurulum kaydı geçersiz; paketleri kaldırmadan önce dosyayı düzeltin.');
  }
  for (const [projectId, fileName] of Object.entries(index)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)
      || typeof fileName !== 'string'
      || path.basename(fileName) !== fileName
      || !fileName.toLowerCase().endsWith(extension)) {
      throw new Error('Modrinth kurulum kaydı geçersiz; paketleri kaldırmadan önce dosyayı düzeltin.');
    }
  }
  return index;
}

function addProjectIdsToFiles(files, installIndex) {
  const projectIdsByFile = new Map(Object.entries(installIndex).map(([projectId, fileName]) => [fileName, projectId]));
  return files.map((file) => {
    const projectId = projectIdsByFile.get(file.name);
    return projectId ? { ...file, projectId } : file;
  });
}

async function readInstallIndex(directory, extension) {
  let contents;
  try {
    contents = await fs.readFile(getIndexPath(directory), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let index;
  try {
    index = JSON.parse(contents);
  } catch {
    throw new Error('Modrinth kurulum kaydı okunamadı; dosyayı düzeltip yeniden deneyin.');
  }
  return validateInstallIndex(index, extension);
}

async function writeInstallIndex(directory, extension, index) {
  validateInstallIndex(index, extension);
  await fs.mkdir(directory, { recursive: true });
  const indexPath = getIndexPath(directory);
  const temporaryPath = `${indexPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(index, null, 2), { flag: 'wx' });
    await fs.rename(temporaryPath, indexPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function persistInstalledFiles(directory, extension, oldIndex, installations) {
  const nextIndex = { ...oldIndex };
  for (const { projectId, fileName } of installations) {
    nextIndex[projectId] = fileName;
  }
  validateInstallIndex(nextIndex, extension);
  await writeInstallIndex(directory, extension, nextIndex);

  const retainedFiles = new Set(Object.values(nextIndex));
  const replacedFiles = new Set(
    Object.values(oldIndex).filter((fileName) => !retainedFiles.has(fileName)),
  );
  await Promise.all([...replacedFiles].map((fileName) => fs.rm(path.join(directory, fileName), { force: true })));
  return nextIndex;
}

async function removeInstalledFile(directory, extension, fileName) {
  if (typeof fileName !== 'string'
    || path.basename(fileName) !== fileName
    || !fileName.toLowerCase().endsWith(extension)) {
    throw new Error('Geçersiz Modrinth dosyası.');
  }
  await fs.unlink(path.join(directory, fileName));
  const oldIndex = await readInstallIndex(directory, extension);
  const nextIndex = Object.fromEntries(
    Object.entries(oldIndex).filter(([, installedName]) => installedName !== fileName),
  );
  await writeInstallIndex(directory, extension, nextIndex);
}

async function removeInstalledProject(directory, extension, projectId, expectedFileName) {
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error('Geçersiz Modrinth proje kimliği.');
  }
  const index = await readInstallIndex(directory, extension);
  const fileName = index[projectId];
  if (!fileName || (expectedFileName && fileName !== expectedFileName)) return false;

  const nextIndex = { ...index };
  delete nextIndex[projectId];
  await writeInstallIndex(directory, extension, nextIndex);
  if (!Object.values(nextIndex).includes(fileName)) {
    await fs.rm(path.join(directory, fileName), { force: true });
  }
  return true;
}

module.exports = {
  addProjectIdsToFiles,
  persistInstalledFiles,
  readInstallIndex,
  removeInstalledFile,
  removeInstalledProject,
};

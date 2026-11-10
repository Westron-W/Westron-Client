const fs = require('node:fs/promises');
const path = require('node:path');

function getScreenshotsDirectory(gameDirectory) {
  return path.join(gameDirectory, 'screenshots');
}

function resolveScreenshotPath(gameDirectory, fileName) {
  if (typeof fileName !== 'string'
    || path.basename(fileName) !== fileName
    || !/^[^<>:"/\\|?*\u0000-\u001f]+\.png$/i.test(fileName)) {
    throw new Error('Ekran görüntüsü dosya adı geçersiz.');
  }
  return path.join(getScreenshotsDirectory(gameDirectory), fileName);
}

async function listScreenshots(gameDirectory, createPreview) {
  if (typeof createPreview !== 'function') {
    throw new Error('Ekran görüntüsü önizlemesi oluşturulamıyor.');
  }
  const directory = getScreenshotsDirectory(gameDirectory);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const screenshots = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;
    const filePath = resolveScreenshotPath(gameDirectory, entry.name);
    const info = await fs.stat(filePath);
    const preview = createPreview(filePath);
    if (typeof preview !== 'string' || !preview.startsWith('data:image/')) {
      throw new Error(`Ekran görüntüsü önizlemesi oluşturulamadı: ${entry.name}`);
    }
    screenshots.push({
      name: entry.name,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      preview,
    });
  }
  return screenshots.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

async function deleteScreenshot(gameDirectory, fileName) {
  const filePath = resolveScreenshotPath(gameDirectory, fileName);
  const info = await fs.stat(filePath);
  if (!info.isFile()) throw new Error('Silinecek ekran görüntüsü bulunamadı.');
  await fs.unlink(filePath);
}

async function readScreenshot(gameDirectory, fileName) {
  const filePath = resolveScreenshotPath(gameDirectory, fileName);
  const info = await fs.lstat(filePath);
  if (!info.isFile()) throw new Error('Ekran görüntüsü bulunamadı.');
  const contents = await fs.readFile(filePath);
  return `data:image/png;base64,${contents.toString('base64')}`;
}

module.exports = {
  deleteScreenshot,
  getScreenshotsDirectory,
  listScreenshots,
  readScreenshot,
  resolveScreenshotPath,
};

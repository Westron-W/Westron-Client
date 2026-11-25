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

async function listScreenshots(gameDirectory, createPreview, options = {}) {
  const { offset = 0, limit } = options;
  const paged = Object.prototype.hasOwnProperty.call(options, 'limit');
  if (typeof createPreview !== 'function') {
    throw new Error('Ekran görüntüsü önizlemesi oluşturulamıyor.');
  }
  if (!Number.isSafeInteger(offset) || offset < 0
    || (paged && (!Number.isSafeInteger(limit) || limit < 1 || limit > 24))) {
    throw new Error('Ekran görüntüsü sayfası geçersiz.');
  }
  const directory = getScreenshotsDirectory(gameDirectory);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { items: [], total: 0 };
    throw error;
  }

  const screenshots = (await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map(async (entry) => {
      const info = await fs.stat(resolveScreenshotPath(gameDirectory, entry.name));
      return {
        name: entry.name,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      };
    })))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  const page = screenshots.slice(offset, paged ? offset + limit : undefined).map((screenshot) => {
    const preview = createPreview(resolveScreenshotPath(gameDirectory, screenshot.name));
    if (typeof preview !== 'string' || !preview.startsWith('data:image/')) {
      throw new Error(`Ekran görüntüsü önizlemesi oluşturulamadı: ${screenshot.name}`);
    }
    return { ...screenshot, preview };
  });
  return { items: page, total: screenshots.length };
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

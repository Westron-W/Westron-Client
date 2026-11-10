const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  deleteScreenshot,
  getScreenshotsDirectory,
  listScreenshots,
  readScreenshot,
  resolveScreenshotPath,
} = require('../game-screenshots.cjs');

test('lists PNG screenshots newest first and supplies preview data', async (context) => {
  const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-screenshots-'));
  context.after(() => fs.rm(gameDirectory, { recursive: true, force: true }));
  const directory = getScreenshotsDirectory(gameDirectory);
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'older.png'), 'old');
  await fs.writeFile(path.join(directory, 'newer.PNG'), 'new');
  await fs.writeFile(path.join(directory, 'notes.txt'), 'not an image');
  await fs.mkdir(path.join(directory, 'folder.png'));
  const fixedTime = new Date('2025-01-01T00:00:00.000Z');
  await fs.utimes(path.join(directory, 'older.png'), fixedTime, fixedTime);

  const screenshots = await listScreenshots(gameDirectory, (filePath) => `data:image/png;base64,${path.basename(filePath)}`);
  assert.deepEqual(screenshots.map((screenshot) => screenshot.name), ['newer.PNG', 'older.png']);
  assert.equal(screenshots[0].preview, 'data:image/png;base64,newer.PNG');
  assert.equal(screenshots[1].size, 3);
});

test('deletes only a validated PNG directly inside the screenshots folder', async (context) => {
  const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-screenshots-'));
  context.after(() => fs.rm(gameDirectory, { recursive: true, force: true }));
  const directory = getScreenshotsDirectory(gameDirectory);
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'capture.png'), 'image');

  assert.equal(resolveScreenshotPath(gameDirectory, 'capture.png'), path.join(directory, 'capture.png'));
  await assert.rejects(deleteScreenshot(gameDirectory, '..\\outside.png'), /dosya adı geçersiz/i);
  await deleteScreenshot(gameDirectory, 'capture.png');
  await assert.rejects(fs.access(path.join(directory, 'capture.png')), { code: 'ENOENT' });
});

test('reads the original screenshot image for the enlarged preview', async (context) => {
  const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-screenshots-'));
  context.after(() => fs.rm(gameDirectory, { recursive: true, force: true }));
  const directory = getScreenshotsDirectory(gameDirectory);
  await fs.mkdir(directory);
  const image = Buffer.from('original image bytes');
  await fs.writeFile(path.join(directory, 'capture.png'), image);

  assert.equal(await readScreenshot(gameDirectory, 'capture.png'), `data:image/png;base64,${image.toString('base64')}`);
  await assert.rejects(readScreenshot(gameDirectory, '..\\outside.png'), /dosya adı geçersiz/i);
});

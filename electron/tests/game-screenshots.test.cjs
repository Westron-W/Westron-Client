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

test('returns an empty screenshot page when the screenshots directory is missing', async (context) => {
  const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-screenshots-empty-'));
  context.after(() => fs.rm(gameDirectory, { recursive: true, force: true }));

  assert.deepEqual(
    await listScreenshots(gameDirectory, () => 'data:image/png;base64,preview'),
    { items: [], total: 0 },
  );
});

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
  assert.deepEqual(screenshots.items.map((screenshot) => screenshot.name), ['newer.PNG', 'older.png']);
  assert.equal(screenshots.items[0].preview, 'data:image/png;base64,newer.PNG');
  assert.equal(screenshots.items[1].size, 3);
  assert.equal(screenshots.total, 2);
});

test('creates previews only for the requested screenshot page', async (context) => {
  const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'westron-screenshots-page-'));
  context.after(() => fs.rm(gameDirectory, { recursive: true, force: true }));
  const directory = getScreenshotsDirectory(gameDirectory);
  await fs.mkdir(directory);
  await Promise.all(['one.png', 'two.png', 'three.png'].map((name) =>
    fs.writeFile(path.join(directory, name), name)));
  const previewed = [];

  const page = await listScreenshots(gameDirectory, (filePath) => {
    previewed.push(path.basename(filePath));
    return 'data:image/png;base64,preview';
  }, { offset: 1, limit: 1 });

  assert.equal(page.total, 3);
  assert.equal(page.items.length, 1);
  assert.deepEqual(previewed, [page.items[0].name]);
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

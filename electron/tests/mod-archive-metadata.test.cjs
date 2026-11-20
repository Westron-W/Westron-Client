const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { getModArchiveMetadata } = require('../mod-archive-metadata.cjs');

function createZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const contents = Buffer.from(entry.contents);
    const compressed = zlib.deflateRawSync(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localRecords.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

async function createModsDirectory() {
  const directory = path.join(os.tmpdir(), `westron-mod-archive-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

test('reads Fabric mod descriptions and icons from safe JAR entries', async () => {
  const directory = await createModsDirectory();
  try {
    const icon = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
    const archive = createZip([
      {
        name: 'fabric.mod.json',
        contents: JSON.stringify({
          id: 'example',
          description: '  A useful   client mod. ',
          icon: 'assets/example/icon.png',
        }),
      },
      { name: 'assets/example/icon.png', contents: icon },
    ]);
    await fs.writeFile(path.join(directory, 'example.jar'), archive);

    const result = await getModArchiveMetadata(directory, ['example.jar']);
    assert.equal(result['example.jar'].description, 'A useful client mod.');
    assert.equal(result['example.jar'].iconUrl, `data:image/png;base64,${icon.toString('base64')}`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects mod metadata requests containing paths outside the mods directory', async () => {
  const directory = await createModsDirectory();
  try {
    await assert.rejects(getModArchiveMetadata(directory, ['..\\outside.jar']), /isteği geçersiz/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('returns empty optional metadata for a JAR without an embedded icon', async () => {
  const directory = await createModsDirectory();
  try {
    await fs.writeFile(path.join(directory, 'plain.jar'), createZip([
      { name: 'META-INF/MANIFEST.MF', contents: 'Manifest-Version: 1.0\n' },
    ]));

    assert.deepEqual(await getModArchiveMetadata(directory, ['plain.jar']), {
      'plain.jar': { iconUrl: '', description: '' },
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_FILES_PER_REQUEST = 200;
const MAX_CENTRAL_DIRECTORY_SIZE = 8 * 1024 * 1024;
const MAX_METADATA_SIZE = 256 * 1024;
const MAX_ICON_SIZE = 512 * 1024;
const MAX_TOTAL_ICON_SIZE = 8 * 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 320;

async function readRange(fileHandle, position, length) {
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await fileHandle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
    if (!result.bytesRead) break;
    bytesRead += result.bytesRead;
  }
  return buffer.subarray(0, bytesRead);
}

async function readZipDirectory(fileHandle, fileSize) {
  const tailSize = Math.min(fileSize, 22 + 0xffff);
  const tail = await readRange(fileHandle, fileSize - tailSize, tailSize);
  let endOffset = -1;
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength <= tail.length) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return null;

  const diskNumber = tail.readUInt16LE(endOffset + 4);
  const directoryDisk = tail.readUInt16LE(endOffset + 6);
  const diskEntryCount = tail.readUInt16LE(endOffset + 8);
  const entryCount = tail.readUInt16LE(endOffset + 10);
  const directorySize = tail.readUInt32LE(endOffset + 12);
  const directoryOffset = tail.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntryCount !== entryCount
    || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff
    || directorySize > MAX_CENTRAL_DIRECTORY_SIZE
    || directoryOffset + directorySize > fileSize) return null;

  const directory = await readRange(fileHandle, directoryOffset, directorySize);
  if (directory.length !== directorySize) return null;
  const entries = [];
  let offset = 0;
  while (offset + 46 <= directory.length && entries.length < entryCount) {
    if (directory.readUInt32LE(offset) !== 0x02014b50) return null;
    const flags = directory.readUInt16LE(offset + 8);
    const method = directory.readUInt16LE(offset + 10);
    const compressedSize = directory.readUInt32LE(offset + 20);
    const uncompressedSize = directory.readUInt32LE(offset + 24);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const localOffset = directory.readUInt32LE(offset + 42);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (offset + entryLength > directory.length) return null;
    const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const normalizedName = normalizeEntryName(name);
    if (normalizedName && !(flags & 1) && (method === 0 || method === 8)
      && compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff
      && localOffset !== 0xffffffff) {
      entries.push({
        name: normalizedName,
        flags,
        method,
        compressedSize,
        uncompressedSize,
        localOffset,
      });
    }
    offset += entryLength;
  }
  return entries;
}

function normalizeEntryName(name) {
  const normalized = name.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return '';
  return normalized;
}

async function readZipEntry(fileHandle, entry, maximumSize) {
  if (entry.compressedSize > maximumSize || entry.uncompressedSize > maximumSize) return null;
  const header = await readRange(fileHandle, entry.localOffset, 30);
  if (header.length !== 30 || header.readUInt32LE(0) !== 0x04034b50) return null;
  const fileNameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataOffset = entry.localOffset + 30 + fileNameLength + extraLength;
  const compressed = await readRange(fileHandle, dataOffset, entry.compressedSize);
  if (compressed.length !== entry.compressedSize) return null;

  let contents;
  try {
    contents = entry.method === 0
      ? compressed
      : zlib.inflateRawSync(compressed, { maxOutputLength: maximumSize });
  } catch (error) {
    if (error.code === 'Z_DATA_ERROR' || error.code === 'Z_BUF_ERROR' || error.code === 'ERR_BUFFER_TOO_LARGE') {
      return null;
    }
    throw error;
  }
  if (contents.length !== entry.uncompressedSize || contents.length > maximumSize) return null;
  return contents;
}

function normalizeDescription(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

function parseTomlValue(text, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"((?:\\\\.|[^"\\\\])*)")`, 'm');
  const match = text.match(pattern);
  if (!match) return '';
  return normalizeDescription(match[1] ?? match[2].replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n'));
}

function isIconEntry(name) {
  return /(?:^|\/)(?:icon|logo|mod-icon)(?:[-_][^/]*)?\.(?:png|jpe?g|webp)$/i.test(name);
}

function getImageMimeType(name, contents) {
  if (contents.length >= 8 && contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff) {
    return 'image/jpeg';
  }
  if (contents.length >= 12 && contents.toString('ascii', 0, 4) === 'RIFF'
    && contents.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

async function extractModMetadata(filePath) {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const fileInfo = await fileHandle.stat();
    const entries = await readZipDirectory(fileHandle, fileInfo.size);
    if (!entries) return { iconUrl: '', iconSize: 0, description: '' };
    const entriesByName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    let description = '';
    let iconName = '';

    const fabricMetadata = entriesByName.get('fabric.mod.json');
    if (fabricMetadata) {
      const contents = await readZipEntry(fileHandle, fabricMetadata, MAX_METADATA_SIZE);
      if (contents) {
        try {
          const metadata = JSON.parse(contents.toString('utf8'));
          description = normalizeDescription(metadata.description);
          const icon = typeof metadata.icon === 'string'
            ? metadata.icon
            : metadata.icon && typeof metadata.icon === 'object'
              ? Object.values(metadata.icon).find((value) => typeof value === 'string')
              : '';
          if (typeof icon === 'string') iconName = normalizeEntryName(icon);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
    }

    const forgeMetadata = entriesByName.get('meta-inf/mods.toml');
    if (forgeMetadata) {
      const contents = await readZipEntry(fileHandle, forgeMetadata, MAX_METADATA_SIZE);
      if (contents) {
        const text = contents.toString('utf8');
        const firstMod = text.match(/\[\[mods\]\]([\s\S]*?)(?=\n\[\[|\s*$)/i)?.[1] || text;
        if (!description) description = parseTomlValue(firstMod, 'description');
        if (!iconName) iconName = normalizeEntryName(parseTomlValue(firstMod, 'logoFile'));
      }
    }

    const iconEntries = entries
      .filter((entry) => isIconEntry(entry.name))
      .sort((left, right) => left.name.split('/').length - right.name.split('/').length
        || left.name.localeCompare(right.name, 'en-US'));
    const iconEntry = entriesByName.get(iconName.toLowerCase())
      || iconEntries[0];
    if (!iconEntry) return { iconUrl: '', iconSize: 0, description };

    const image = await readZipEntry(fileHandle, iconEntry, MAX_ICON_SIZE);
    const mimeType = image && getImageMimeType(iconEntry.name, image);
    return {
      iconUrl: mimeType ? `data:${mimeType};base64,${image.toString('base64')}` : '',
      iconSize: mimeType ? image.length : 0,
      description,
    };
  } finally {
    await fileHandle.close();
  }
}

async function getModArchiveMetadata(modsDirectory, fileNames) {
  if (!Array.isArray(fileNames) || fileNames.length > MAX_FILES_PER_REQUEST
    || fileNames.some((fileName) => typeof fileName !== 'string'
      || fileName.length > 255 || path.basename(fileName) !== fileName
      || !fileName.toLowerCase().endsWith('.jar'))) {
    throw new Error('Mod dosyası bilgisi isteği geçersiz.');
  }

  const directoryPath = path.resolve(modsDirectory);
  const metadata = {};
  let totalIconSize = 0;
  for (const fileName of new Set(fileNames)) {
    const filePath = path.resolve(directoryPath, fileName);
    if (path.dirname(filePath) !== directoryPath) throw new Error('Mod dosyası yolu geçersiz.');
    const result = await extractModMetadata(filePath);
    const iconUrl = totalIconSize + result.iconSize <= MAX_TOTAL_ICON_SIZE ? result.iconUrl : '';
    if (iconUrl) totalIconSize += result.iconSize;
    metadata[fileName] = { iconUrl, description: result.description };
  }
  return metadata;
}

module.exports = { getModArchiveMetadata };

const fs = require('node:fs/promises');
const path = require('node:path');

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

async function writeLocalSkinIdentity(minecraftDir, minecraftUsername, westronUsername) {
  if (!USERNAME_PATTERN.test(minecraftUsername)) {
    throw new Error('Minecraft skin identity username is invalid.');
  }
  if (westronUsername !== null && !USERNAME_PATTERN.test(westronUsername)) {
    throw new Error('Westron skin identity username is invalid.');
  }

  const identityFile = path.join(minecraftDir, 'westron-skins', 'local-player.properties');
  if (!westronUsername) {
    await fs.rm(identityFile, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(identityFile), { recursive: true });
  const temporaryFile = `${identityFile}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryFile,
      `minecraftUsername=${minecraftUsername}\nwestronUsername=${westronUsername}\n`,
      { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, identityFile);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true });
    throw error;
  }
}

module.exports = { writeLocalSkinIdentity };

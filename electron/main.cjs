const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const packageJson = require('../package.json');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const {
  createWestronAuthRefresher,
  createWestronApiClient,
  registerWestronIpcHandlers,
} = require('./westron-api.cjs');
const { writeLocalSkinIdentity: writeLocalSkinIdentityFile } = require('./westron-skin-identity.cjs');
const {
  ModCompatibilityError,
  selectCompatibleVersion,
  selectInstallableVersion,
  resolveDependencyVersion,
} = require('./modrinth-versions.cjs');
const { persistInstalledFiles, readInstallIndex, removeInstalledFile } = require('./modrinth-installed-files.cjs');
const { createMicrosoftAuthService } = require('./microsoft-auth.cjs');
const { addVerifiedMavenMirrors, formatInstallError } = require('./minecraft-downloads.cjs');

const GAME_VERSION = '26.3';
const DISPLAY_VERSION = packageJson.displayVersion;
const RELEASE_VERSION = packageJson.version;
const DEFAULT_LOADER = 'fabric';
const SUPPORTED_LOADERS = new Set(['vanilla', 'fabric', 'forge']);
const GAME_VERSION_MIN = [1, 8, 0];
const GAME_VERSION_MAX = [26, 3, 0];
const westronApi = createWestronApiClient();
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const WESTRON_AUTH_FILE = () => path.join(app.getPath('userData'), 'westron-auth.bin');
const MICROSOFT_AUTH_FILE = () => path.join(app.getPath('userData'), 'microsoft-auth.bin');
let minecraftKitPromise;
let minecraftVersionsCache = { expiresAt: 0, versions: [] };
let updateStatus = { status: 'idle', currentVersion: DISPLAY_VERSION, percent: 0 };
let updateCheckPromise = null;
const refreshWestronAuth = createWestronAuthRefresher({
  readCredentials: readWestronAuth,
  refresh: (input) => westronApi.refresh(input),
  saveCredentials: saveWestronAuth,
  clearCredentials: clearWestronAuth,
});

function isSupportedReleaseVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value)) return false;
  const parsed = value.split('.').map(Number);
  while (parsed.length < 3) parsed.push(0);
  const compare = (left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  };
  return compare(parsed, GAME_VERSION_MIN) >= 0 && compare(parsed, GAME_VERSION_MAX) <= 0;
}

function isSupportedGameVersion(value) {
  return isSupportedReleaseVersion(value)
    || (typeof value === 'string' && /^(?:\d{2}\.\d+-snapshot-\d+|\d{2}w\d{2}[a-z])$/i.test(value));
}

function getInstanceDir(minecraftDir, gameVersion, loader) {
  return path.join(minecraftDir, 'westron-profiles', gameVersion, loader);
}

function profileVersionIsInstalled(versions, gameVersion, loader) {
  if (loader === 'vanilla') return versions.includes(gameVersion);
  if (loader === 'fabric') {
    return versions.some((name) => name.startsWith('fabric-loader-') && name.endsWith(`-${gameVersion}`));
  }
  return versions.some((name) => name.startsWith(`${gameVersion}-forge-`));
}

function publishUpdateStatus(nextStatus) {
  updateStatus = { ...updateStatus, ...nextStatus, currentVersion: DISPLAY_VERSION };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:update-status', updateStatus);
  }
}

function canUseAutoUpdater() {
  return app.isPackaged && process.platform === 'win32';
}

function checkForUpdates() {
  if (!canUseAutoUpdater()) {
    publishUpdateStatus({
      status: 'unavailable',
      message: process.platform === 'darwin'
        ? 'macOS güncellemeleri web sitesi üzerinden yayımlanmaktadır.'
        : 'Güncelleme kontrolü yalnızca kurulu Windows sürümünde kullanılabilir.',
    });
    return Promise.resolve(updateStatus);
  }
  if (updateCheckPromise) return updateCheckPromise;
  publishUpdateStatus({ status: 'checking', percent: 0, message: 'Yeni sürüm kontrol ediliyor.' });
  updateCheckPromise = autoUpdater.checkForUpdates().then((result) => {
    if (result && !result.isUpdateAvailable) {
      publishUpdateStatus({
        status: 'up-to-date',
        version: DISPLAY_VERSION,
        message: 'Şu anda yeni bir güncelleme bulunmuyor.',
      });
    }
    return updateStatus;
  }).catch((error) => {
    console.error(`Update check failed: ${error.message}`);
    publishUpdateStatus({
      status: 'error',
      message: 'Güncelleme kaynağına ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.',
    });
    return updateStatus;
  }).finally(() => {
    updateCheckPromise = null;
  });
  return updateCheckPromise;
}

async function downloadUpdate() {
  if (!canUseAutoUpdater()) throw new Error('Güncellemeler kurulu Windows sürümünde kullanılabilir.');
  if (updateStatus.status !== 'available') throw new Error('İndirilecek bir güncelleme bulunmuyor.');
  publishUpdateStatus({ status: 'downloading', percent: 0, message: 'Güncelleme indiriliyor.' });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error(`Update download failed: ${error.message}`);
    publishUpdateStatus({
      status: 'error',
      message: 'Güncelleme indirilemedi. Daha sonra yeniden deneyebilirsiniz.',
    });
    throw new Error('Güncelleme indirilemedi. Daha sonra yeniden deneyebilirsiniz.');
  }
}

function configureAutoUpdater() {
  if (!canUseAutoUpdater()) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('checking-for-update', () => {
    publishUpdateStatus({ status: 'checking', message: 'Yeni sürüm kontrol ediliyor.' });
  });
  autoUpdater.on('update-available', (info) => {
    publishUpdateStatus({
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 4000) : '',
      message: 'Yeni bir sürüm indirilmeye hazır.',
    });
  });
  autoUpdater.on('update-not-available', () => {
    publishUpdateStatus({ status: 'up-to-date', version: DISPLAY_VERSION, message: 'Uygulama güncel.' });
  });
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateStatus({
      status: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      transferred: progress.transferred,
      total: progress.total,
      message: 'Güncelleme indiriliyor.',
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdateStatus({
      status: 'downloaded',
      version: info.version,
      percent: 100,
      message: 'Güncelleme hazır. Kurulum için uygulamayı yeniden başlatın.',
    });
  });
  autoUpdater.on('error', (error) => {
    console.error(`Auto-update error: ${error.message}`);
    publishUpdateStatus({
      status: 'error',
      message: 'Güncelleme işlemi başarısız oldu. Uygulamayı kullanmaya devam edebilirsiniz.',
    });
  });
}

function getLegacySettingsFiles() {
  return [
    path.join(app.getPath('appData'), 'Nocturne Launcher', 'settings.json'),
    path.join(app.getPath('appData'), 'nocturne-launcher', 'settings.json'),
  ];
}

function getDefaultMinecraftDir() {
  return process.platform === 'darwin'
    ? path.join(app.getPath('appData'), 'minecraft')
    : path.join(app.getPath('appData'), '.minecraft');
}

async function readSettings() {
  let contents;
  try {
    contents = await fs.readFile(SETTINGS_FILE(), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    for (const legacyFile of getLegacySettingsFiles()) {
      try {
        contents = await fs.readFile(legacyFile, 'utf8');
        break;
      } catch (legacyError) {
        if (legacyError.code !== 'ENOENT') throw legacyError;
      }
    }
    if (contents === undefined) {
      return {
        minecraftDir: getDefaultMinecraftDir(),
        offlineUsername: 'Player',
        gameVersion: GAME_VERSION,
        loader: DEFAULT_LOADER,
        language: 'tr',
        theme: 'dark',
        languageSetupComplete: false,
        profileNoticeDismissed: false,
      };
    }
  }
  let saved;
  try {
    saved = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Launcher ayar dosyası okunamadı: ${error.message}`);
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('Launcher ayar dosyasının biçimi geçersiz.');
  }
  return {
    minecraftDir: typeof saved.minecraftDir === 'string' ? saved.minecraftDir : getDefaultMinecraftDir(),
    offlineUsername: typeof saved.offlineUsername === 'string' ? saved.offlineUsername : 'Player',
    gameVersion: isSupportedGameVersion(saved.gameVersion) ? saved.gameVersion : GAME_VERSION,
    loader: SUPPORTED_LOADERS.has(saved.loader) ? saved.loader : DEFAULT_LOADER,
    language: ['tr', 'en', 'de', 'fr', 'es', 'ru', 'it'].includes(saved.language) ? saved.language : 'tr',
    theme: saved.theme === 'light' ? 'light' : 'dark',
    languageSetupComplete: saved.languageSetupComplete === true,
    profileNoticeDismissed: saved.profileNoticeDismissed === true,
  };
}

async function saveSettings(settings) {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf8');
}

async function readWestronAuth() {
  let encrypted;
  try {
    encrypted = await fs.readFile(WESTRON_AUTH_FILE());
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('İşletim sistemi güvenli parola deposu kullanılamıyor; Westron oturumu açılamadı.');
  }
  let credentials;
  try {
    credentials = JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    throw new Error('Westron oturum dosyası açılamadı. Hesaptan çıkış yapıp yeniden giriş yapın.');
  }
  if (!credentials || typeof credentials.accessToken !== 'string'
    || typeof credentials.refreshToken !== 'string' || !credentials.account) {
    throw new Error('Westron oturum dosyasının biçimi geçersiz.');
  }
  return credentials;
}

async function saveWestronAuth(credentials) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('İşletim sistemi güvenli parola deposu kullanılamıyor; oturum güvenle saklanmadı.');
  }
  await fs.mkdir(path.dirname(WESTRON_AUTH_FILE()), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
  await fs.writeFile(WESTRON_AUTH_FILE(), encrypted, { mode: 0o600 });
}

async function clearWestronAuth() {
  await fs.rm(WESTRON_AUTH_FILE(), { force: true });
}

async function readMicrosoftAuth() {
  let encrypted;
  try {
    encrypted = await fs.readFile(MICROSOFT_AUTH_FILE());
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('İşletim sistemi güvenli kimlik bilgisi deposu kullanılamıyor; Microsoft oturumu açılamadı.');
  }
  try {
    const credentials = JSON.parse(safeStorage.decryptString(encrypted));
    if (typeof credentials?.refreshToken !== 'string'
      || typeof credentials?.account?.username !== 'string'
      || typeof credentials?.account?.uuid !== 'string') {
      throw new Error('Invalid credentials');
    }
    return credentials;
  } catch {
    throw new Error('Microsoft oturum dosyası açılamadı. Microsoft hesabından çıkış yapıp yeniden giriş yapın.');
  }
}

async function saveMicrosoftAuth(credentials) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('İşletim sistemi güvenli kimlik bilgisi deposu kullanılamıyor; Microsoft oturumu güvenle saklanmadı.');
  }
  await fs.mkdir(path.dirname(MICROSOFT_AUTH_FILE()), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
  await fs.writeFile(MICROSOFT_AUTH_FILE(), encrypted, { mode: 0o600 });
}

async function clearMicrosoftAuth() {
  await fs.rm(MICROSOFT_AUTH_FILE(), { force: true });
}

const microsoftAuth = createMicrosoftAuthService({
  getMinecraftKit,
  clientIdValue: process.env.MINECRAFT_KIT_MSA_CLIENT_ID || 'bcfe67e2-a947-4621-a650-81db09205316',
  openExternal: (url) => shell.openExternal(url),
  loadStoredAuth: readMicrosoftAuth,
  saveStoredAuth: saveMicrosoftAuth,
  clearStoredAuth: clearMicrosoftAuth,
});

async function westronRegister({ username, email, password }) {
  const result = await westronApi.register({ username, email, password });
  return result.message;
}

async function westronVerifyEmail({ email, token }) {
  const result = await westronApi.verifyEmail({ email, token });
  return result.message;
}

async function westronResendVerification({ email }) {
  const result = await westronApi.resendVerification({ email });
  return result.message;
}

async function westronRequestPasswordReset({ email }) {
  const result = await westronApi.requestPasswordReset({ email });
  return result.message;
}

async function westronResetPassword({ email, token, newPassword }) {
  const result = await westronApi.resetPassword({ email, token, newPassword });
  return result.message;
}

async function westronLogin({ email, password }) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('İşletim sistemi güvenli parola deposu kullanılamıyor; Westron ile giriş güvenle saklanamaz.');
  }
  const credentials = await westronApi.login({ email, password });
  await saveWestronAuth(credentials);
  return credentials.account;
}

async function westronGetProfile() {
  let credentials = await readWestronAuth();
  if (!credentials) return null;
  try {
    return await westronApi.getProfile(credentials.accessToken);
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    return westronApi.getProfile(renewed.accessToken);
  }
}

async function westronUploadSkin(model) {
  if (model !== 'classic' && model !== 'slim') throw new Error('Skin modeli geçersiz.');
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  const selection = await dialog.showOpenDialog({
    title: 'PNG skin dosyasını seç',
    properties: ['openFile'],
    filters: [{ name: 'PNG skin', extensions: ['png'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const filePath = selection.filePaths[0];
  const fileBuffer = await fs.readFile(filePath);
  if (fileBuffer.length > 1024 * 1024) throw new Error('Skin PNG dosyası 1 MiB sınırını aşamaz.');
  let accessToken = credentials.accessToken;
  let profile = await westronApi.getProfile(accessToken).catch(async (error) => {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    return westronApi.getProfile(accessToken);
  });
  const upload = () => {
    const form = new FormData();
    form.append('skin', new Blob([fileBuffer], { type: 'image/png' }), path.basename(filePath));
    return westronApi.request('/api/v1/me/skin', {
      method: profile.skin ? 'PUT' : 'POST',
      body: form,
      accessToken,
      headers: { 'X-Skin-Model': model },
    });
  };
  try {
    profile = await upload();
    return { cancelled: false, profile };
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    profile = await upload();
    return { cancelled: false, profile };
  }
}


async function westronUploadCape() {
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  const selection = await dialog.showOpenDialog({
    title: 'PNG pelerin dosyasını seç',
    properties: ['openFile'],
    filters: [{ name: 'PNG pelerin', extensions: ['png'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const filePath = selection.filePaths[0];
  const fileBuffer = await fs.readFile(filePath);
  if (fileBuffer.length > 1024 * 1024) throw new Error('Pelerin PNG dosyası 1 MiB sınırını aşamaz.');
  let accessToken = credentials.accessToken;
  let profile = await westronApi.getProfile(accessToken).catch(async (error) => {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    return westronApi.getProfile(accessToken);
  });
  const upload = () => {
    const form = new FormData();
    form.append('cape', new Blob([fileBuffer], { type: 'image/png' }), path.basename(filePath));
    return westronApi.request('/api/v1/me/cape', {
      method: profile?.cape ? 'PUT' : 'POST',
      body: form,
      accessToken,
    });
  };
  try {
    profile = await upload();
    return { cancelled: false, profile };
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    profile = await upload();
    return { cancelled: false, profile };
  }
}

async function westronDeleteCape() {
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  let accessToken = credentials.accessToken;
  const del = () => westronApi.request('/api/v1/me/cape', {
    method: 'DELETE',
    accessToken,
  });
  try {
    await del();
    return westronGetProfile();
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    await del();
    return westronGetProfile();
  }
}

async function westronDeleteSkin() {
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  let accessToken = credentials.accessToken;
  const del = () => westronApi.request('/api/v1/me/skin', {
    method: 'DELETE',
    accessToken,
  });
  try {
    await del();
    return westronGetProfile();
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    await del();
    return westronGetProfile();
  }
}

async function westronLogout() {
  const credentials = await readWestronAuth();
  if (!credentials) return 'Westron hesabından çıkış yapıldı.';
  try {
    await westronApi.logout(credentials.accessToken);
  } catch {
    await clearWestronAuth();
    return 'Bu cihazdaki Westron oturumu silindi; sunucuya erişilemediği için oturum sunucuda süre sonuna kadar açık kalabilir.';
  }
  await clearWestronAuth();
  return 'Westron hesabından çıkış yapıldı.';
}

function getModsDir(minecraftDir) {
  return path.join(minecraftDir, 'mods');
}

function getContentDirectory(minecraftDir, type) {
  if (type === 'resourcepack') return path.join(minecraftDir, 'resourcepacks');
  if (type === 'shader') return path.join(minecraftDir, 'shaderpacks');
  throw new Error('Geçersiz Modrinth içerik türü.');
}

async function listFiles(directory, extensions) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) continue;
      const filePath = path.join(directory, entry.name);
      const info = await fs.stat(filePath);
      files.push({ name: entry.name, size: info.size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listMods(minecraftDir) {
  return listFiles(getModsDir(minecraftDir), ['.jar']);
}

async function getState() {
  const settings = await readSettings();
  const gameDirectory = getInstanceDir(settings.minecraftDir, settings.gameVersion, settings.loader);
  let loaderInstalled = false;
  try {
    const versions = await fs.readdir(path.join(gameDirectory, 'versions'));
    loaderInstalled = profileVersionIsInstalled(versions, settings.gameVersion, settings.loader);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const mods = await listMods(gameDirectory);
  const resourcePacksDir = getContentDirectory(gameDirectory, 'resourcepack');
  const shaderPacksDir = getContentDirectory(gameDirectory, 'shader');
  const resourcePacks = await listFiles(resourcePacksDir, ['.zip']);
  const shaderPacks = await listFiles(shaderPacksDir, ['.zip']);
  const resourcePackInstalls = await readInstallIndex(resourcePacksDir, '.zip');
  const shaderPackInstalls = await readInstallIndex(shaderPacksDir, '.zip');
  const modInstalls = await readInstallIndex(getModsDir(gameDirectory), '.jar');
  return {
    ...settings,
    gameDirectory,
    version: app.getVersion(),
    displayVersion: DISPLAY_VERSION,
    microsoftAuthConfigured: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      process.env.MINECRAFT_KIT_MSA_CLIENT_ID || 'bcfe67e2-a947-4621-a650-81db09205316'
    ),
    loaderInstalled,
    fabricInstalled: settings.loader === 'fabric' && loaderInstalled,
    westronModSupported: settings.loader === 'fabric' && settings.gameVersion === GAME_VERSION,
    javaAvailable: await findJava(gameDirectory),
    mods,
    resourcePacks,
    shaderPacks,
    resourcePackProjects: Object.keys(resourcePackInstalls),
    shaderProjects: Object.keys(shaderPackInstalls),
    modrinthModProjects: Object.keys(modInstalls),
    menuModInstalled: settings.loader === 'fabric' && settings.gameVersion === GAME_VERSION
      && mods.some((mod) => mod.name === `westron-client-skin-${RELEASE_VERSION}.jar`),
  };
}

async function findJava(minecraftDir) {
  const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', javaExecutable) : '']
    .filter(Boolean);
  const runtimeDir = path.join(minecraftDir, 'runtime');
  const pendingDirectories = [runtimeDir];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === javaExecutable) return entryPath;
      else if (entry.isDirectory()) pendingDirectories.push(entryPath);
    }
  }
  if (process.platform === 'darwin') {
    const macJvmRoot = '/Library/Java/JavaVirtualMachines';
    try {
      const jvmEntries = await fs.readdir(macJvmRoot, { withFileTypes: true });
      for (const entry of jvmEntries) {
        if (entry.isDirectory()) {
          candidates.push(path.join(macJvmRoot, entry.name, 'Contents', 'Home', 'bin', 'java'));
        }
      }
    } catch {
      // Directory may not exist.
    }
    candidates.push('/usr/bin/java');
    candidates.push('/opt/homebrew/bin/java');
    candidates.push('/usr/local/bin/java');
  }
  candidates.push(javaExecutable);
  for (const candidate of candidates) {
    if (candidate === javaExecutable) {
      const available = await new Promise((resolve) => {
        const child = spawn(candidate, ['-version'], { windowsHide: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('close', (code) => resolve(code === 0));
      });
      if (available) return candidate;
      continue;
    }
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue to PATH lookup.
    }
  }
  return '';
}

async function installBundledMenu(minecraftDir) {
  const jarName = `westron-client-skin-${RELEASE_VERSION}.jar`;
  const legacyJarNames = ['westron-client-skin-1.0.jar', 'westron-client-skin-1.0.0.jar', 'westron-client-menu-1.0.0.jar', 'nocturne-menu-1.0.0.jar'];
  const sourcePath = app.isPackaged
    ? path.join(process.resourcesPath, jarName)
    : path.join(__dirname, '..', 'fabric-mod', 'build', 'libs', jarName);
  try {
    await fs.access(sourcePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Westron Client bulunamadı. Önce `npm run build:mod` komutunu çalıştırın.');
    }
    throw error;
  }
  const modsDir = getModsDir(minecraftDir);
  await fs.mkdir(modsDir, { recursive: true });
  await Promise.all(legacyJarNames.map((legacyJarName) =>
    fs.rm(path.join(modsDir, legacyJarName), { force: true })));
  await fs.copyFile(sourcePath, path.join(modsDir, jarName));
}

async function writeLocalSkinIdentity(minecraftDir, minecraftUsername) {
  let westronUsername = null;
  try {
    const credentials = await readWestronAuth();
    if (typeof credentials?.account?.username === 'string'
      && /^[A-Za-z0-9_]{3,16}$/.test(credentials.account.username)) {
      westronUsername = credentials.account.username;
      try {
        await westronApi.setMinecraftProfile(minecraftUsername, credentials.accessToken);
      } catch (error) {
        if (error.status !== 401) throw error;
        const renewed = await refreshWestronAuth(credentials);
        await westronApi.setMinecraftProfile(minecraftUsername, renewed.accessToken);
      }
    }
  } catch (error) {
    console.error(`Could not sync Westron Minecraft profile: ${error.message}`);
  }
  await writeLocalSkinIdentityFile(minecraftDir, minecraftUsername, westronUsername);
}


class DetachedProcessSpawner {
  spawn(command, args, options) {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return {
      pid: child.pid ?? -1,
      stdout: new (require('node:stream').Readable)({ read() { this.push(null); } }),
      stderr: new (require('node:stream').Readable)({ read() { this.push(null); } }),
      exited: new Promise((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
        child.once('error', () => resolve({ code: 1, signal: null }));
      }),
      kill(signal) {
        return child.kill(signal);
      },
    };
  }
}

async function getMinecraftKit() {
  if (!minecraftKitPromise) {
    minecraftKitPromise = import('@loontail/minecraft-kit').then(({
      MinecraftKit,
      Loaders,
      AuthModes,
      asAzureClientId,
      asMicrosoftRefreshToken,
      asMinecraftVersionId,
      DownloadCategories,
      createInstallProgressTracker,
      toOnlineAuth,
    }) => ({
      kit: new MinecraftKit({ spawner: new DetachedProcessSpawner() }),
      Loaders,
      AuthModes,
      asAzureClientId,
      asMicrosoftRefreshToken,
      asMinecraftVersionId,
      DownloadCategories,
      createInstallProgressTracker,
      toOnlineAuth,
    }));
  }
  return minecraftKitPromise;
}

async function resolveGameTarget(minecraftDir, gameVersion, loader) {
  const { kit, Loaders, asMinecraftVersionId } = await getMinecraftKit();
  const target = await kit.targets.resolve({
    id: `westron-client-${gameVersion}-${loader}`,
    directory: getInstanceDir(minecraftDir, gameVersion, loader),
    minecraft: { version: asMinecraftVersionId(gameVersion) },
    loader: { type: Loaders[loader.toUpperCase()] },
  });
  return { kit, target };
}

async function runMinecraftInstall(kit, plan, options) {
  try {
    return await kit.install.run(addVerifiedMavenMirrors(plan), options);
  } catch (error) {
    throw formatInstallError(error);
  }
}

async function runMinecraftInstallWithProgress(kit, plan, options = {}) {
  const { createInstallProgressTracker } = await getMinecraftKit();
  const tracker = createInstallProgressTracker(plan, { throttleMs: 200 });
  const unsubscribe = tracker.subscribe(sendInstallProgress);
  try {
    return await runMinecraftInstall(kit, plan, { ...options, onEvent: tracker.onEvent });
  } finally {
    tracker.finish();
    unsubscribe();
  }
}

async function installGameProfile() {
  const state = await getState();
  if (!state.loaderInstalled) {
    const { kit, target } = await resolveGameTarget(state.minecraftDir, state.gameVersion, state.loader);
    await fs.mkdir(state.gameDirectory, { recursive: true });
    const plan = await kit.install.plan(target);
    await runMinecraftInstallWithProgress(kit, plan);
  }
  if (state.westronModSupported) await installBundledMenu(state.gameDirectory);
  return `Minecraft ${state.gameVersion} ${state.loader} profili hazır.`;
}

async function installFabric() {
  const state = await getState();
  if (state.loader !== 'fabric' || state.gameVersion !== GAME_VERSION) {
    throw new Error('Bu işlem yalnızca Minecraft 26.3 Fabric profili için kullanılabilir.');
  }
  const { kit, target } = await resolveGameTarget(state.minecraftDir, state.gameVersion, state.loader);
  const plan = await kit.install.plan(target);
  const { DownloadCategories } = await getMinecraftKit();
  await runMinecraftInstallWithProgress(kit, plan, {
    actionCategories: new Set([
      DownloadCategories.FABRIC_LIBRARY,
      DownloadCategories.RUNTIME_FILE,
    ]),
  });
  await installBundledMenu(state.gameDirectory);
  return `Fabric ${state.gameVersion} ve Westron Client kuruldu.`;
}

function sendInstallProgress(snapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app:install-progress', snapshot);
  }
}

async function launchGame({ mode, offlineUsername }) {
  if (mode !== 'microsoft' && mode !== 'offline') throw new Error('Minecraft giriş yöntemi geçersiz.');
  if (mode === 'offline' && (typeof offlineUsername !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername))) {
    throw new Error('Kullanıcı adı 3-16 karakter olmalı; yalnızca İngilizce harf, rakam ve alt çizgi kullanılabilir.');
  }
  const settings = await readSettings();
  if (mode === 'offline') await saveSettings({ ...settings, offlineUsername });
  const state = await getState();
  if (!state.loaderInstalled) throw new Error(`Önce Minecraft ${state.gameVersion} ${state.loader} profilini kurun.`);

  const microsoftSession = mode === 'microsoft' ? await microsoftAuth.getLaunchSession() : null;
  const username = microsoftSession?.account.username ?? offlineUsername;
  const { kit, target } = await resolveGameTarget(state.minecraftDir, state.gameVersion, state.loader);
  const plan = await kit.install.plan(target);
  const { AuthModes } = await getMinecraftKit();
  await runMinecraftInstallWithProgress(kit, plan);
  if (state.westronModSupported) await installBundledMenu(state.gameDirectory);
  await writeLocalSkinIdentity(state.gameDirectory, username);

  const composition = await kit.launch.compose(target, {
    auth: microsoftSession?.auth ?? { mode: AuthModes.OFFLINE, username },
    launcherName: 'Westron Client',
    launcherVersion: app.getVersion(),
  });
  const session = kit.launch.run(composition);
  session.exited.then((exit) => {
    if (exit.code !== 0 && !exit.aborted) {
      console.error(`Minecraft ${username} oturumuyla ${exit.code ?? exit.signal} koduyla kapandı.`);
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('app:game-exited', { username, ...exit });
    }
  });
  app.quit();
  return `Minecraft ${username} adıyla başlatıldı.`;
}

const MODRINTH_TYPES = new Set(['mod', 'resourcepack', 'shader']);

function assertModrinthType(type) {
  if (!MODRINTH_TYPES.has(type)) throw new Error('Geçersiz Modrinth içerik türü.');
}

function modrinthHeaders() {
  return { 'User-Agent': `WestronClient/${RELEASE_VERSION} (launcher)` };
}

async function getMinecraftVersions() {
  if (Date.now() < minecraftVersionsCache.expiresAt) return minecraftVersionsCache.versions;
  const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Minecraft sürüm listesi alınamadı (${response.status}).`);
  const manifest = await response.json();
  if (!Array.isArray(manifest.versions)) throw new Error('Minecraft sürüm listesi beklenen biçimde değil.');
  const releases = manifest.versions
    .filter((version) => version.type === 'release' && isSupportedReleaseVersion(version.id))
    .map((version) => ({ id: version.id, kind: 'release' }));
  const latestSnapshot = manifest.versions.find((version) => version.type === 'snapshot');
  if (latestSnapshot) releases.unshift({ id: latestSnapshot.id, kind: 'snapshot' });
  minecraftVersionsCache = { expiresAt: Date.now() + 60 * 60 * 1000, versions: releases };
  return releases;
}

async function assertKnownMinecraftVersion(gameVersion) {
  if (!isSupportedGameVersion(gameVersion)) throw new Error('Minecraft sürümü geçersiz.');
  const versions = await getMinecraftVersions();
  if (!versions.some((version) => version.id === gameVersion)) {
    throw new Error('Minecraft sürümü listede değil veya artık desteklenmiyor. Sürüm seçimini yenileyin.');
  }
}

async function searchModrinth(type, query, gameVersion, loader) {
  assertModrinthType(type);
  await assertKnownMinecraftVersion(gameVersion);
  if (type === 'mod' && !['fabric', 'forge'].includes(loader)) {
    throw new Error('Mod aramak ve kurmak için Fabric veya Forge seçin.');
  }
  const facets = type === 'mod'
    ? [['project_type:mod'], [`versions:${gameVersion}`], [`categories:${loader}`]]
    : [[`project_type:${type}`], [`versions:${gameVersion}`]];
  const params = new URLSearchParams({
    query,
    facets: JSON.stringify(facets),
    limit: '18',
    index: 'downloads',
  });
  const response = await fetch(`https://api.modrinth.com/v2/search?${params}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Modrinth araması başarısız oldu (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.hits)) throw new Error('Modrinth arama sonucu beklenen biçimde değil.');
  return data.hits.map((hit) => ({
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url || '',
    downloads: hit.downloads,
    categories: hit.categories,
  }));
}

async function getProjectVersions(projectId, type = 'mod', gameVersion = GAME_VERSION, loader = DEFAULT_LOADER) {
  assertModrinthType(type);
  await assertKnownMinecraftVersion(gameVersion);
  const filters = { game_versions: JSON.stringify([gameVersion]) };
  if (type === 'mod') {
    if (!['fabric', 'forge'].includes(loader)) throw new Error('Mod kurulumu için Fabric veya Forge seçin.');
    filters.loaders = JSON.stringify([loader]);
  }
  const params = new URLSearchParams(filters);
  const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Modrinth sürümleri alınamadı (${response.status}).`);
  const versions = await response.json();
  if (!Array.isArray(versions)) throw new Error('Modrinth sürüm listesi beklenen biçimde değil.');
  return versions;
}

async function getCompatibleVersion(projectId, gameVersion, loader) {
  const versions = await getProjectVersions(projectId, 'mod', gameVersion, loader);
  return selectCompatibleVersion(versions, gameVersion, loader);
}

async function getVersionById(versionId) {
  const response = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Gerekli mod sürümü alınamadı (${response.status}).`);
  return response.json();
}

async function getProjectTitle(projectId) {
  const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mod bilgisi alınamadı (${response.status}).`);
  const project = await response.json();
  return project.title;
}

async function downloadModrinthFile(file, directory, expectedExtension) {
  if (typeof file?.filename !== 'string'
    || path.basename(file.filename) !== file.filename
    || !file.filename.toLowerCase().endsWith(expectedExtension)) {
    throw new Error(`Modrinth dosyası ${expectedExtension} biçiminde değil.`);
  }
  const downloadUrl = new URL(file.url);
  if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'cdn.modrinth.com') {
    throw new Error('Güvenilmeyen Modrinth indirme adresi reddedildi.');
  }
  const expectedSha1 = file.hashes?.sha1;
  if (typeof expectedSha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(expectedSha1)) {
    throw new Error('Modrinth dosyası için doğrulanabilir SHA-1 bilgisi alınamadı.');
  }
  await fs.mkdir(directory, { recursive: true });
  const targetPath = path.join(directory, file.filename);
  try {
    const existing = await fs.readFile(targetPath);
    if (createHash('sha1').update(existing).digest('hex') === expectedSha1.toLowerCase()) {
      return { fileName: file.filename, installed: false };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const download = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
  if (!download.ok) throw new Error(`Modrinth dosyası indirilemedi (${download.status}).`);
  const contents = Buffer.from(await download.arrayBuffer());
  if (createHash('sha1').update(contents).digest('hex') !== expectedSha1.toLowerCase()) {
    throw new Error(`İndirilen "${file.filename}" dosyasının SHA-1 doğrulaması başarısız oldu.`);
  }
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { flag: 'wx' });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return { fileName: file.filename, installed: true };
}

async function resolveModInstallPlan(projectId, gameVersion, loader, selectedVersionId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Geçersiz Modrinth proje kimliği.');
  const state = await getState();
  if (!['fabric', 'forge'].includes(loader)) throw new Error('Mod kurmak için Fabric veya Forge seçin.');
  if (state.gameVersion !== gameVersion || state.loader !== loader) {
    throw new Error('Oyun sürümü veya loader değişti. Listeyi yenileyip kurulumu yeniden başlatın.');
  }
  if (!state.loaderInstalled) throw new Error(`Önce Minecraft ${gameVersion} ${loader} profilini kurun.`);

  const projectTitles = new Map();
  async function titleFor(id) {
    if (!projectTitles.has(id)) projectTitles.set(id, getProjectTitle(id));
    return projectTitles.get(id);
  }
  let rootVersions = await getProjectVersions(projectId, 'mod', gameVersion, loader);
  if (selectedVersionId) {
    rootVersions = rootVersions.filter((version) => version.id === selectedVersionId);
    if (!rootVersions.length) throw new Error('Seçilen yayın seçili Minecraft sürümü veya loader ile uyumlu değil.');
  }
  const result = await selectInstallableVersion(
    rootVersions,
    gameVersion,
    loader,
    async (rootVersion) => {
      const plan = [];
      const visited = new Set();
      async function resolveRequired(version, title, dependencyProjectId = version.project_id) {
        const versionKey = version.id || version.project_id;
        if (!versionKey || visited.has(versionKey)) return;
        visited.add(versionKey);
        if (!selectCompatibleVersion([version], gameVersion, loader)) {
          throw new ModCompatibilityError(`"${title}" için Minecraft ${gameVersion} ${loader} sürümü uyumlu değil.`);
        }
        for (const dependency of version.dependencies || []) {
          if (dependency.dependency_type !== 'required') continue;
          const dependencyVersion = await resolveDependencyVersion(dependency, {
            gameVersion,
            loader,
            dependencyLabel: dependency.project_id || dependency.version_id,
            getVersionById,
            getCompatibleVersion: (dependencyProjectId) =>
              getCompatibleVersion(dependencyProjectId, gameVersion, loader),
          });
          const requiredProjectId = dependencyVersion.project_id || dependency.project_id;
          const dependencyTitle = requiredProjectId
            ? await titleFor(requiredProjectId)
            : dependencyVersion.name;
          await resolveRequired(dependencyVersion, dependencyTitle, requiredProjectId);
        }
        plan.push({ version, title, projectId: dependencyProjectId });
      }
      await resolveRequired(rootVersion, await titleFor(projectId), projectId);
      return plan;
    },
  );
  if (!result) throw new Error(`Minecraft ${gameVersion} ${loader} ile uyumlu mod sürümü bulunamadı.`);

  const modsDir = getModsDir(state.gameDirectory);
  await fs.mkdir(modsDir, { recursive: true });
  return { plan: result.plan, modsDir };
}

async function installMod(projectId, gameVersion, loader, selectedVersionId = null, confirmedDependencyIds = null) {
  const { plan, modsDir } = await resolveModInstallPlan(projectId, gameVersion, loader, selectedVersionId);
  const filesToInstall = plan.map(({ version, title, projectId: dependencyProjectId }) => {
    const jarFiles = version.files?.filter((item) => item.filename?.toLowerCase().endsWith('.jar')) ?? [];
    const file = jarFiles.find((item) => item.primary) || jarFiles[0];
    if (!file
      || typeof file.filename !== 'string'
      || path.basename(file.filename) !== file.filename
      || /[<>:"/\\|?*\x00-\x1f]/.test(file.filename)
      || !file.filename.toLowerCase().endsWith('.jar')) {
      throw new Error('İndirilecek mod JAR dosyası bulunamadı.');
    }
    return { file, title, projectId: dependencyProjectId };
  });

  const modInstallIndex = await readInstallIndex(modsDir, '.jar');
  const missing = [];
  for (const item of filesToInstall) {
    const safeName = item.file.filename;
    try {
      const existing = await fs.readFile(path.join(modsDir, safeName));
      const expectedSha1 = item.file.hashes?.sha1;
      if (typeof expectedSha1 !== 'string'
        || createHash('sha1').update(existing).digest('hex') !== expectedSha1.toLowerCase()) {
        missing.push({ ...item, safeName });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push({ ...item, safeName });
    }
  }

  const requiredMods = missing.filter((item) =>
    item.projectId !== projectId && !modInstallIndex[item.projectId]);
  if (requiredMods.length > 0) {
    const dependencies = [...new Map(requiredMods.map((item) => [
      item.projectId || item.safeName,
      { projectId: item.projectId || item.safeName, title: item.title },
    ])).values()];
    const confirmedIds = Array.isArray(confirmedDependencyIds)
      ? [...new Set(confirmedDependencyIds.filter((id) => typeof id === 'string'))].sort()
      : [];
    const requiredIds = dependencies.map((dependency) => dependency.projectId).sort();
    if (confirmedIds.length !== requiredIds.length
      || confirmedIds.some((id, index) => id !== requiredIds[index])) {
      return { status: 'confirmation-required', dependencies };
    }
  }

  const installedFiles = [];
  for (const { file, safeName } of missing) {
    const result = await downloadModrinthFile(file, modsDir, '.jar');
    if (result.installed) installedFiles.push(safeName);
  }
  await persistInstalledFiles(
    modsDir,
    '.jar',
    modInstallIndex,
    filesToInstall.map((item) => ({ projectId: item.projectId, fileName: item.file.filename })),
  );
  return {
    status: 'installed',
    files: installedFiles,
    cancelled: false,
    dependencies: requiredMods.map((item) => item.title),
  };
}

async function installModrinthPack(type, projectId, gameVersion, selectedVersionId) {
  if (type !== 'resourcepack' && type !== 'shader') {
    throw new Error('Kaynak paketi veya shader paketi türü seçilmelidir.');
  }
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error('Geçersiz Modrinth proje kimliği.');
  }
  const versions = await getProjectVersions(projectId, type, gameVersion);
  const version = selectedVersionId
    ? versions.find((candidate) => candidate.id === selectedVersionId)
    : selectCompatibleVersion(versions, gameVersion);
  if (!version) {
    const label = type === 'resourcepack' ? 'kaynak paketi' : 'shader paketi';
    throw new Error(`Minecraft ${gameVersion} ile uyumlu ${label} sürümü bulunamadı.`);
  }
  const file = version.files?.find((item) => item.primary && item.filename?.toLowerCase().endsWith('.zip'))
    || version.files?.find((item) => item.filename?.toLowerCase().endsWith('.zip'));
  if (!file) throw new Error('Bu Modrinth sürümünde indirilebilir ZIP dosyası bulunamadı.');
  const directory = getContentDirectory((await getState()).gameDirectory, type);
  const installIndex = await readInstallIndex(directory, '.zip');
  const result = await downloadModrinthFile(file, directory, '.zip');
  await persistInstalledFiles(directory, '.zip', installIndex, [{ projectId, fileName: result.fileName }]);
  return {
    status: result.installed ? 'installed' : 'already-installed',
    fileName: result.fileName,
    versionNumber: version.version_number,
  };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b0d11',
    title: 'Westron Client',
    icon: process.platform === 'win32'
      ? (app.isPackaged
        ? path.join(process.resourcesPath, 'westron-client.ico')
        : path.join(__dirname, '..', 'build', 'westron-client.ico'))
      : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Electron preload failed (${path.basename(preloadPath)}): ${error.message}`);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer navigation failed (${errorCode}): ${errorDescription}; ${validatedURL}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process exited (${details.reason}, code ${details.exitCode}).`);
  });
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      console.error(`Renderer console error (${path.basename(details.sourceId)}:${details.lineNumber}).`);
    }
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('app:update-status', updateStatus);
  });
  window.setMenuBarVisibility(false);
  if (process.env.NODE_ENV === 'development') {
    window.loadURL('http://localhost:5173').catch((error) => {
      console.error(`Could not load the Vite renderer: ${error.message}`);
    });
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch((error) => {
      console.error(`Could not load the production renderer: ${error.message}`);
    });
  }
}

ipcMain.handle('app:state', getState);
ipcMain.handle('app:microsoft-account', () => microsoftAuth.getAccount());
ipcMain.handle('app:microsoft-sign-in', () => microsoftAuth.signIn());
ipcMain.handle('app:microsoft-cancel-sign-in', () => microsoftAuth.cancelSignIn());
ipcMain.handle('app:microsoft-sign-out', () => microsoftAuth.signOut());
ipcMain.handle('app:choose-minecraft-dir', async () => {
  const settings = await readSettings();
  const result = await dialog.showOpenDialog({
    title: 'Minecraft klasörünü seç',
    defaultPath: settings.minecraftDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return getState();
  await saveSettings({ ...settings, minecraftDir: result.filePaths[0] });
  return getState();
});
ipcMain.handle('app:game-versions', getMinecraftVersions);
ipcMain.handle('app:save-game-options', async (_event, gameVersion, loader, confirmNewProfile = false, dismissNotice = false) => {
  if (!SUPPORTED_LOADERS.has(loader)) throw new Error('Mod yükleyicisi geçersiz.');
  await assertKnownMinecraftVersion(gameVersion);
  if (loader === 'fabric' && /^\d+\.\d+/.test(gameVersion)) {
    const [major, minor] = gameVersion.split('.').map(Number);
    if (major === 1 && minor < 14) {
      throw new Error('Fabric bu Minecraft sürümünü desteklemiyor; Vanilla veya Forge seçin.');
    }
  }
  const settings = await readSettings();
  const profileDirectory = getInstanceDir(settings.minecraftDir, gameVersion, loader);
  let profileExists = true;
  try {
    await fs.access(profileDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    profileExists = false;
  }
  if (!profileExists && !settings.profileNoticeDismissed && !confirmNewProfile) {
    return { requiresConfirmation: true, profileDirectory };
  }
  const nextSettings = {
    ...settings,
    gameVersion,
    loader,
    profileNoticeDismissed: settings.profileNoticeDismissed || dismissNotice,
  };
  await saveSettings(nextSettings);
  await fs.mkdir(profileDirectory, { recursive: true });
  return { requiresConfirmation: false, state: await getState() };
});
ipcMain.handle('app:save-language', async (_event, language) => {
  if (!['tr', 'en', 'de', 'fr', 'es', 'ru', 'it'].includes(language)) throw new Error('Arayüz dili desteklenmiyor.');
  const settings = await readSettings();
  await saveSettings({ ...settings, language, languageSetupComplete: true });
  return getState();
});
ipcMain.handle('app:save-theme', async (_event, theme) => {
  if (theme !== 'dark' && theme !== 'light') throw new Error('Arayüz teması geçersiz.');
  const settings = await readSettings();
  await saveSettings({ ...settings, theme });
  return getState();
});
ipcMain.handle('app:install-game-profile', installGameProfile);
ipcMain.handle('app:install-fabric', installFabric);
ipcMain.handle('app:launch-game', (_event, options) => launchGame(options));
ipcMain.handle('app:install-menu', async () => {
  const state = await getState();
  if (!state.westronModSupported || !state.fabricInstalled) {
    throw new Error('Westron oyun içi menüsü yalnızca Minecraft 26.3 Fabric profilinde kullanılabilir.');
  }
  await installBundledMenu(state.gameDirectory);
  return 'Westron Client kuruldu.';
});
ipcMain.handle('app:search-mods', async (_event, query) => {
  const state = await getState();
  return searchModrinth('mod', String(query || '').slice(0, 100), state.gameVersion, state.loader);
});
ipcMain.handle('app:search-content', async (_event, type, query) => {
  const state = await getState();
  return searchModrinth(String(type), String(query || '').slice(0, 100), state.gameVersion, state.loader);
});
ipcMain.handle('app:project-versions', async (_event, type, projectId) => {
  const state = await getState();
  const versions = await getProjectVersions(String(projectId), String(type), state.gameVersion, state.loader);
  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.version_number,
    name: version.name,
    datePublished: version.date_published,
    gameVersions: version.game_versions,
    loaders: version.loaders,
  }));
});
ipcMain.handle('app:install-mod', async (_event, projectId, selectedVersionId, confirmedDependencyIds) => {
  const state = await getState();
  return installMod(
    String(projectId),
    state.gameVersion,
    state.loader,
    typeof selectedVersionId === 'string' ? selectedVersionId : null,
    confirmedDependencyIds,
  );
});
ipcMain.handle('app:install-content', async (_event, type, projectId, selectedVersionId) => {
  const state = await getState();
  return installModrinthPack(
    String(type),
    String(projectId),
    state.gameVersion,
    typeof selectedVersionId === 'string' ? selectedVersionId : null,
  );
});
ipcMain.handle('app:update-status', () => updateStatus);
ipcMain.handle('app:check-for-updates', checkForUpdates);
ipcMain.handle('app:download-update', downloadUpdate);
ipcMain.handle('app:install-update', () => {
  if (updateStatus.status !== 'downloaded') throw new Error('Önce güncelleme indirilmelidir.');
  autoUpdater.quitAndInstall(false, true);
});
registerWestronIpcHandlers(ipcMain, {
  getAccount: async () => {
    const credentials = await readWestronAuth();
    return credentials?.account || null;
  },
  register: westronRegister,
  login: westronLogin,
  verifyEmail: westronVerifyEmail,
  resendVerification: westronResendVerification,
  requestPasswordReset: westronRequestPasswordReset,
  resetPassword: westronResetPassword,
  profile: westronGetProfile,
  uploadSkin: westronUploadSkin,
  deleteSkin: westronDeleteSkin,
  uploadCape: westronUploadCape,
  deleteCape: westronDeleteCape,
  logout: westronLogout,
});
ipcMain.handle('app:remove-mod', async (_event, fileName) => {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.jar')) {
    throw new Error('Geçersiz mod dosyası.');
  }
  const state = await getState();
  await removeInstalledFile(getModsDir(state.gameDirectory), '.jar', fileName);
  return getState();
});
ipcMain.handle('app:remove-content', async (_event, type, fileName) => {
  if ((type !== 'resourcepack' && type !== 'shader')
    || typeof fileName !== 'string'
    || path.basename(fileName) !== fileName
    || !fileName.toLowerCase().endsWith('.zip')) {
    throw new Error('Geçersiz kaynak paketi veya shader dosyası.');
  }
  const state = await getState();
  await removeInstalledFile(getContentDirectory(state.gameDirectory, type), '.zip', fileName);
  return getState();
});
ipcMain.handle('app:open-mods-folder', async () => {
  const state = await getState();
  const modsDir = getModsDir(state.gameDirectory);
  await fs.mkdir(modsDir, { recursive: true });
  const error = await shell.openPath(modsDir);
  if (error) throw new Error(error);
});
ipcMain.handle('app:open-content-folder', async (_event, type) => {
  if (type !== 'resourcepack' && type !== 'shader') throw new Error('Geçersiz Modrinth içerik türü.');
  const state = await getState();
  const directory = getContentDirectory(state.gameDirectory, type);
  await fs.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
});
function setupApplicationMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Düzen',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Pencere',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.whenReady().then(() => {
  setupApplicationMenu();
  configureAutoUpdater();
  createWindow();
  if (canUseAutoUpdater()) {
    setTimeout(() => { void checkForUpdates(); }, 5000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

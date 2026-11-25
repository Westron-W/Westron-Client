const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, Menu, nativeImage, net, session, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const packageJson = require('../package.json');
// electron-builder omits its build configuration from the packaged package.json.
const WINDOWS_APP_USER_MODEL_ID = 'com.westron.launcher';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const launcherIconPath = process.platform === 'win32'
  ? (app.isPackaged
    ? path.join(process.resourcesPath, 'westron-launcher.ico')
    : path.join(__dirname, '..', 'build', 'westron-launcher.ico'))
  : undefined;
const launcherIcon = launcherIconPath ? nativeImage.createFromPath(launcherIconPath) : undefined;
if (launcherIconPath && launcherIcon.isEmpty()) {
  throw new Error(`Could not load Westron Launcher icon: ${launcherIconPath}`);
}
app.setName('Westron Launcher');
if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
app.setPath('cache', path.join(app.getPath('userData'), 'renderer-cache-v2'));
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
const {
  addProjectIdsToFiles,
  persistInstalledFiles,
  readInstallIndex,
  removeInstalledFile,
} = require('./modrinth-installed-files.cjs');
const { getModArchiveMetadata } = require('./mod-archive-metadata.cjs');
const { createMicrosoftAuthService } = require('./microsoft-auth.cjs');
const { addVerifiedMavenMirrors, formatInstallError } = require('./minecraft-downloads.cjs');
const { readUpdateFiles } = require('./update-publisher.cjs');
const { configureUpdateFeed } = require('./update-config.cjs');
const { canGrantAudioMediaPermission } = require('./media-permissions.cjs');
const { createMinecraftSkinLookup } = require('./minecraft-skin.cjs');
const {
  getPerformancePresetProjects,
  QUALITY_SHADER,
  SHADER_LOADER,
} = require('./performance-presets.cjs');
const {
  defaultPerformanceProfile,
  forgetPerformanceProjects,
  removePerformanceManagedFiles,
  readPerformanceProfile,
  writePerformanceProfile,
} = require('./performance-profile.cjs');
const {
  getDefaultMinecraftDir: resolveDefaultMinecraftDir,
  migrateLegacyMinecraftProfiles,
} = require('./minecraft-paths.cjs');
const {
  MAX_CUSTOM_PROFILE_MEMORY_MB,
  assertSafeCustomProfileDeletion,
  assertUniqueCustomProfileDirectory,
  normalizeCustomProfiles,
  validateCustomProfileFields,
} = require('./custom-profiles.cjs');
const {
  deleteScreenshot,
  getScreenshotsDirectory,
  listScreenshots,
  readScreenshot,
  resolveScreenshotPath,
} = require('./game-screenshots.cjs');

const GAME_VERSION = '26.3';
const DISPLAY_VERSION = packageJson.version;
const RELEASE_VERSION = packageJson.version;
const DEFAULT_LOADER = 'fabric';
const SUPPORTED_LOADERS = new Set(['vanilla', 'fabric', 'forge']);
const GAME_VERSION_MIN = [1, 8, 0];
const GAME_VERSION_MAX = [26, 3, 0];
const WESTRON_SKIN_API_BASE_URL = process.env.WESTRON_SKIN_API_BASE_URL || 'https://westronskin.sytes.net';
const westronApi = createWestronApiClient({
  baseUrl: WESTRON_SKIN_API_BASE_URL,
  fetchImpl: (url, options) => net.fetch(url, options),
});
const getMinecraftSkinUrl = createMinecraftSkinLookup();
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const WESTRON_AUTH_FILE = () => path.join(app.getPath('userData'), 'westron-auth.bin');
const MICROSOFT_AUTH_FILE = () => path.join(app.getPath('userData'), 'microsoft-auth.bin');
let minecraftKitPromise;
let stateLoadPromise = null;
const javaPathCache = new Map();
let minecraftVersionsCache = { expiresAt: 0, versions: [] };
let updateStatus = { status: 'idle', currentVersion: DISPLAY_VERSION, percent: 0 };
let updateCheckPromise = null;
let voiceCallActive = false;
let shouldQuitAfterVoiceCall = false;
let mainWindow = null;
let voiceCallWindow = null;
let voiceCallWindowReady = false;
let voiceCallWindowState = null;
let mainWindowHiddenForVoiceCall = false;
let isClosingVoiceCallWindow = false;
let appIsQuitting = false;
const activeGameSessions = new Set();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

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

async function assertValidGameOptions(gameVersion, loader) {
  if (!SUPPORTED_LOADERS.has(loader)) throw new Error('Mod yükleyicisi geçersiz.');
  await assertKnownMinecraftVersion(gameVersion);
  if (loader === 'fabric' && /^\d+\.\d+/.test(gameVersion)) {
    const [major, minor] = gameVersion.split('.').map(Number);
    if (major === 1 && minor < 14) {
      throw new Error('Fabric bu Minecraft sürümünü desteklemiyor; Vanilla veya Forge seçin.');
    }
  }
}

function getInstanceDir(minecraftDir, gameVersion, loader) {
  return path.join(minecraftDir, 'westron-profiles', gameVersion, loader);
}

function getSelectedCustomProfile(settings) {
  return settings.customProfiles.find((profile) => profile.id === settings.selectedCustomProfileId) ?? null;
}

function getMaxCustomMemoryMb() {
  const totalMemoryMb = Math.floor(os.totalmem() / (1024 * 1024));
  const availableMemoryMb = Math.floor((totalMemoryMb * 0.75) / 256) * 256;
  return Math.max(1024, Math.min(MAX_CUSTOM_PROFILE_MEMORY_MB, availableMemoryMb));
}

function isStandardProfileDirectory(directory, minecraftDir) {
  const profilesRoot = path.resolve(minecraftDir, 'westron-profiles');
  const resolvedDirectory = path.resolve(directory);
  if (resolvedDirectory === path.resolve(minecraftDir)) return true;
  const relativeDirectory = path.relative(profilesRoot, resolvedDirectory);
  if (!relativeDirectory || relativeDirectory === '.') return true;
  const segments = relativeDirectory.split(path.sep);
  return segments.length === 2 && SUPPORTED_LOADERS.has(segments[1].toLowerCase());
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
  configureUpdateFeed(autoUpdater, process.platform);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableDifferentialDownload = true;
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
    path.join(app.getPath('appData'), 'westron-client', 'settings.json'),
    path.join(app.getPath('appData'), 'Westron Client', 'settings.json'),
    path.join(app.getPath('appData'), 'Nocturne Launcher', 'settings.json'),
    path.join(app.getPath('appData'), 'nocturne-launcher', 'settings.json'),
  ];
}

function getDefaultMinecraftDir() {
  const appDataDirectory = process.platform === 'win32'
    ? process.env.APPDATA
    : app.getPath('appData');
  const pathApi = process.platform === 'win32' ? path.win32 : path.posix;
  if (typeof appDataDirectory !== 'string' || !pathApi.isAbsolute(appDataDirectory)) {
    throw new Error('Minecraft klasörü için geçerli uygulama verisi yolu bulunamadı.');
  }
  return resolveDefaultMinecraftDir(appDataDirectory, process.platform);
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
  }
  let saved = {};
  if (contents !== undefined) {
    try {
      saved = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Launcher ayar dosyası okunamadı: ${error.message}`);
    }
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('Launcher ayar dosyasının biçimi geçersiz.');
  }
  const targetMinecraftDir = getDefaultMinecraftDir();
  if (process.platform === 'win32') {
    await fs.mkdir(path.join(targetMinecraftDir, 'westron-profiles'), { recursive: true });
    const legacyDirectories = [
      saved.minecraftDir,
      path.join(app.getPath('appData'), 'westron-client', 'renderer-cache-v2', '.minecraft'),
    ].filter((directory) => typeof directory === 'string' && directory.length > 0);
    for (const legacyDirectory of new Set(legacyDirectories)) {
      await migrateLegacyMinecraftProfiles(legacyDirectory, targetMinecraftDir);
    }
  }
  const minecraftDir = process.platform === 'win32'
    ? targetMinecraftDir
    : (typeof saved.minecraftDir === 'string' ? saved.minecraftDir : targetMinecraftDir);
  const customProfiles = normalizeCustomProfiles(saved.customProfiles);
  if (customProfiles.some((profile) => isStandardProfileDirectory(profile.directory, minecraftDir))) {
    throw new Error('Özel profil için standart oyun profillerinden farklı bir klasör seçin.');
  }
  const settings = {
    minecraftDir,
    offlineUsername: typeof saved.offlineUsername === 'string' ? saved.offlineUsername : 'Player',
    gameVersion: isSupportedGameVersion(saved.gameVersion) ? saved.gameVersion : GAME_VERSION,
    loader: SUPPORTED_LOADERS.has(saved.loader) ? saved.loader : DEFAULT_LOADER,
    language: ['tr', 'en', 'de', 'fr', 'es', 'ru', 'it'].includes(saved.language) ? saved.language : 'en',
    theme: saved.theme === 'light' ? 'light' : 'dark',
    languageSetupComplete: saved.languageSetupComplete === true,
    profileNoticeDismissed: saved.profileNoticeDismissed === true,
    gameBehavior: saved.gameBehavior === 'close-on-game-exit'
      ? 'close-on-game-launch'
      : (['close-on-game-launch', 'stay-open', 'hide-and-restore'].includes(saved.gameBehavior)
        ? saved.gameBehavior : 'close-on-game-launch'),
    customProfiles,
    selectedCustomProfileId: typeof saved.selectedCustomProfileId === 'string'
      && Array.isArray(saved.customProfiles)
      && saved.customProfiles.some((profile) => profile?.id === saved.selectedCustomProfileId)
      ? saved.selectedCustomProfileId
      : null,
  };
  if (process.platform === 'win32') {
    await saveSettings(settings);
  }
  return settings;
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

async function withWestronApiAccess(operation) {
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  try {
    return await operation(credentials.accessToken);
  } catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    return operation(renewed.accessToken);
  }
}

async function westronListFriends() {
  return withWestronApiAccess((accessToken) => westronApi.listFriends(accessToken));
}

async function westronGetFriendSkinUrl(input) {
  const username = typeof input?.username === 'string' ? input.username.trim() : '';
  const rawMinecraftUsername = typeof input?.minecraftUsername === 'string'
    ? input.minecraftUsername.trim()
    : '';
  const minecraftUsername = /^[A-Za-z0-9_]{3,16}$/.test(rawMinecraftUsername)
    ? rawMinecraftUsername
    : null;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    console.warn('[Westron] Profil adı geçersiz olduğu için skin isteği atlandı.');
    return null;
  }
  if (rawMinecraftUsername && !minecraftUsername) {
    console.warn('[Westron] Minecraft kullanıcı adı geçersiz; skin araması Westron adıyla yapılacak.');
  }

  let profile = null;
  try {
    profile = await westronApi.getPublicProfile(username);
  } catch (error) {
    const status = Number(error?.status);
    const unavailable = error instanceof TypeError
      || error?.name === 'TimeoutError'
      || error?.message === 'Westron Skin API sunucusuna ulaşılamadı.'
      || error?.message === 'Westron Skin API geçersiz bir yanıt döndürdü.'
      || [404, 429, 500, 502, 503, 504].includes(status);
    if (!unavailable) {
      throw error;
    }
  }
  const skinUrl = profile?.skin?.url;
  if (typeof skinUrl === 'string') {
    try {
      const url = new URL(skinUrl);
      const trustedOrigins = [
        new URL(WESTRON_SKIN_API_BASE_URL).origin,
        'https://westronclient.myvnc.com',
      ];
      if (url.protocol === 'https:' && trustedOrigins.includes(url.origin)) {
        return `${url.href}${url.search ? '&' : '?'}v=${encodeURIComponent(profile.skin.updatedAt ?? '')}`;
      }
    } catch {
      return getMinecraftSkinUrl(minecraftUsername || username);
    }
  }
  return getMinecraftSkinUrl(minecraftUsername || username);
}

async function westronSearchFriends({ query }) {
  if (typeof query !== 'string' || query.length > 16) {
    return [];
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.searchFriends(query.trim(), accessToken));
}

async function westronListGroups() {
  return withWestronApiAccess((accessToken) => westronApi.listGroups(accessToken));
}

async function westronCreateGroup({ name, memberUserIds }) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32
    || !Array.isArray(memberUserIds)) {
    throw new Error('Grup bilgileri geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.createGroup(name.trim(), memberUserIds, accessToken));
}

async function westronRenameGroup({ groupId, name }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)
    || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32) {
    throw new Error('Grup bilgileri geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.renameGroup(groupId, name.trim(), accessToken));
}

async function westronDeleteGroup({ groupId }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)) {
    throw new Error('Grup kimliği geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.deleteGroup(groupId, accessToken));
}

async function westronRemoveGroupMember({ groupId, memberUserId }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)
    || typeof memberUserId !== 'string' || !memberUserId.trim() || memberUserId.length > 64) {
    throw new Error('Grup üyesi bilgileri geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.removeGroupMember(groupId, memberUserId, accessToken));
}

async function westronListGroupConversation({ groupId }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)) {
    throw new Error('Grup kimliği geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.listGroupConversation(groupId, accessToken));
}

async function westronSendGroupMessage({ groupId, body }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)
    || typeof body !== 'string' || !body.trim() || body.length > 2000) {
    throw new Error('Grup mesajı bilgileri geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.sendGroupMessage(groupId, body, accessToken));
}

async function westronGetGroupMessagePhoto({ groupId, messageId }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)
    || typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    throw new Error('Grup fotoğrafı bilgisi geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.getGroupMessagePhoto(groupId, messageId, accessToken));
}

async function westronSendGroupPhoto({ groupId, filePath, fileName, fileBuffer }) {
  if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)) {
    throw new Error('Grup kimliği geçersiz.');
  }
  if (!Buffer.isBuffer(fileBuffer) && (typeof filePath !== 'string' || !filePath.trim())) {
    throw new Error('Fotoğraf dosyası seçilmedi.');
  }
  const uploadBuffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : await fs.readFile(filePath);
  const uploadName = typeof fileName === 'string' ? fileName : path.basename(filePath);
  if (!/\.(png|jpe?g)$/i.test(uploadName)) throw new Error('Fotoğraf biçimi desteklenmiyor.');
  if (uploadBuffer.length > 10 * 1024 * 1024) {
    throw new Error('Fotoğraf 10 MiB sınırını aşamaz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.sendGroupPhotoMessage(groupId, uploadName, uploadBuffer, accessToken));
}

async function westronChooseAndSendGroupPhoto({ groupId }) {
  const selection = await dialog.showOpenDialog({
    title: 'Gruba fotoğraf gönder',
    properties: ['openFile'],
    filters: [{ name: 'Fotoğraf', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const result = await westronSendGroupPhoto({ groupId, filePath: selection.filePaths[0] });
  return { cancelled: false, ...result };
}

async function westronSendFriendRequest({ username }) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new Error('Westron kullanıcı adı geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.sendFriendRequest(username, accessToken));
}

async function westronRespondToFriendRequest({ requestId, accept }) {
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId) || typeof accept !== 'boolean') {
    throw new Error('Arkadaşlık isteği bilgisi geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.respondFriendRequest(requestId, accept, accessToken));
}

async function westronCancelFriendRequest({ requestId }) {
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new Error('Arkadaşlık isteği bilgisi geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.cancelFriendRequest(requestId, accessToken));
}

async function westronRemoveFriend({ userId }) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 64) {
    throw new Error('Arkadaş hesabı geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.removeFriend(userId, accessToken));
}

async function westronUpdatePresence({ inGame, serverName }) {
  if (typeof inGame !== 'boolean') throw new Error('Oyuncu durumu geçersiz.');
  return withWestronApiAccess((accessToken) =>
    westronApi.updatePresence(inGame, accessToken, serverName));
}

async function westronSendEphemeralMessage({ recipientUserId, body }) {
  if (typeof recipientUserId !== 'string' || !recipientUserId.trim() || recipientUserId.length > 64
    || typeof body !== 'string' || body.length > 2000 || !body.trim()) {
    throw new Error('Mesaj bilgileri geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.sendEphemeralMessage(recipientUserId, body, accessToken));
}

async function westronListEphemeralMessages() {
  return withWestronApiAccess((accessToken) => westronApi.listEphemeralMessages(accessToken));
}

async function westronListConversation({ friendUserId }) {
  if (typeof friendUserId !== 'string' || !friendUserId.trim() || friendUserId.length > 64) {
    throw new Error('Arkadaş hesabı geçersiz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.listConversation(friendUserId, accessToken));
}

async function westronGetMessagePhoto({ messageId }) {
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    throw new Error('Mesaj kimliği geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.getMessagePhoto(messageId, accessToken));
}

async function westronRecallMessage({ messageId, groupId }) {
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    throw new Error('Mesaj kimliği geçersiz.');
  }
  if (groupId !== undefined) {
    if (typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId)) {
      throw new Error('Grup kimliği geçersiz.');
    }
    return withWestronApiAccess((accessToken) =>
      westronApi.recallGroupMessage(groupId, messageId, accessToken));
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.recallEphemeralMessage(messageId, accessToken));
}

async function westronSendPhotoMessage({ recipientUserId, filePath, fileName, fileBuffer }) {
  if (typeof recipientUserId !== 'string' || !recipientUserId.trim() || recipientUserId.length > 64) {
    throw new Error('Arkadaş hesabı geçersiz.');
  }
  if (!Buffer.isBuffer(fileBuffer) && (typeof filePath !== 'string' || !filePath.trim())) {
    throw new Error('Fotoğraf dosyası seçilmedi.');
  }
  const uploadBuffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : await fs.readFile(filePath);
  const uploadName = typeof fileName === 'string' ? fileName : path.basename(filePath);
  if (!/\.(png|jpe?g)$/i.test(uploadName)) throw new Error('Fotoğraf biçimi desteklenmiyor.');
  if (uploadBuffer.length > 10 * 1024 * 1024) {
    throw new Error('Fotoğraf 10 MiB sınırını aşamaz.');
  }
  return withWestronApiAccess((accessToken) =>
    westronApi.sendPhotoMessage(recipientUserId, uploadName, uploadBuffer, accessToken));
}

async function prepareWestronScreenshot(filePath) {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error('Ekran görüntüsü okunamadı.');
  const { width, height } = image.getSize();
  if (width < 1 || height < 1) throw new Error('Ekran görüntüsü boyutları geçersiz.');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const resized = scale < 1
    ? image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good',
    })
    : image;
  const fileBuffer = resized.toJPEG(82);
  if (fileBuffer.length > 10 * 1024 * 1024) {
    throw new Error('Sıkıştırılmış ekran görüntüsü 10 MiB sınırını aşıyor.');
  }
  return {
    fileName: `${path.parse(filePath).name}.jpg`,
    fileBuffer,
  };
}

async function westronConsumeEphemeralMessage({ messageId }) {
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    throw new Error('Mesaj kimliği geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.consumeEphemeralMessage(messageId, accessToken));
}

async function westronGetVoiceCallIceServers() {
  return withWestronApiAccess((accessToken) => westronApi.getVoiceCallIceServers(accessToken));
}

async function westronSendVoiceCallSignal(signal) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)
    || typeof signal.recipientUserId !== 'string'
    || (signal.groupId !== undefined && (typeof signal.groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(signal.groupId)))
    || typeof signal.callId !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(signal.callId)
    || !['offer', 'answer', 'candidate', 'hangup', 'reject'].includes(signal.type)
    || typeof signal.sdp !== 'string' || signal.sdp.length > 60_000) {
    throw new Error('Sesli arama sinyali geçersiz.');
  }
  return withWestronApiAccess((accessToken) => westronApi.sendVoiceCallSignal(signal, accessToken));
}

async function westronConsumeVoiceCallSignals() {
  return withWestronApiAccess((accessToken) => westronApi.consumeVoiceCallSignals(accessToken));
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


async function westronUploadBackTexture(type) {
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  const label = type === 'cape' ? 'Pelerin' : 'Elitra';
  const selection = await dialog.showOpenDialog({
    title: `PNG ${label.toLowerCase()} dosyasını seç`,
    properties: ['openFile'],
    filters: [{ name: `PNG ${label.toLowerCase()}`, extensions: ['png'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const filePath = selection.filePaths[0];
  const fileBuffer = await fs.readFile(filePath);
  if (fileBuffer.length > 1024 * 1024) throw new Error(`${label} PNG dosyası 1 MiB sınırını aşamaz.`);
  let accessToken = credentials.accessToken;
  let profile = await westronApi.getProfile(accessToken).catch(async (error) => {
    if (error.status !== 401) throw error;
    const renewed = await refreshWestronAuth(credentials);
    accessToken = renewed.accessToken;
    return westronApi.getProfile(accessToken);
  });
  const upload = () => {
    const form = new FormData();
    form.append(type, new Blob([fileBuffer], { type: 'image/png' }), path.basename(filePath));
    return westronApi.request(`/api/v1/me/${type}`, {
      method: profile?.[type] ? 'PUT' : 'POST',
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

async function westronUploadCape() {
  return westronUploadBackTexture('cape');
}

async function westronUploadElytra() {
  return westronUploadBackTexture('elytra');
}

async function westronDeleteBackTexture(type) {
  const credentials = await readWestronAuth();
  if (!credentials) throw new Error('Önce Westron hesabınızla giriş yapın.');
  let accessToken = credentials.accessToken;
  const del = () => westronApi.request(`/api/v1/me/${type}`, {
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

async function westronDeleteCape() {
  return westronDeleteBackTexture('cape');
}

async function westronDeleteElytra() {
  return westronDeleteBackTexture('elytra');
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
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile()
        && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension)))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const info = await fs.stat(filePath);
        return { name: entry.name, size: info.size };
      }));
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listMods(minecraftDir) {
  return listFiles(getModsDir(minecraftDir), ['.jar']);
}

function getState() {
  if (!stateLoadPromise) {
    stateLoadPromise = loadState().finally(() => {
      stateLoadPromise = null;
    });
  }
  return stateLoadPromise;
}

async function loadState() {
  const settings = await readSettings();
  const customProfile = getSelectedCustomProfile(settings);
  const gameVersion = customProfile?.gameVersion ?? settings.gameVersion;
  const loader = customProfile?.loader ?? settings.loader;
  const gameDirectory = customProfile?.directory ?? getInstanceDir(settings.minecraftDir, gameVersion, loader);
  const resourcePacksDir = getContentDirectory(gameDirectory, 'resourcepack');
  const shaderPacksDir = getContentDirectory(gameDirectory, 'shader');
  const modsDir = getModsDir(gameDirectory);
  const [
    performanceProfile,
    versions,
    unindexedMods,
    unindexedResourcePacks,
    unindexedShaderPacks,
    resourcePackInstalls,
    shaderPackInstalls,
    modInstalls,
    javaAvailable,
  ] = await Promise.all([
    readPerformanceProfile(gameDirectory),
    fs.readdir(path.join(gameDirectory, 'versions')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }),
    listMods(gameDirectory),
    listFiles(resourcePacksDir, ['.zip']),
    listFiles(shaderPacksDir, ['.zip']),
    readInstallIndex(resourcePacksDir, '.zip'),
    readInstallIndex(shaderPacksDir, '.zip'),
    readInstallIndex(modsDir, '.jar'),
    findJava(gameDirectory),
  ]);
  const loaderInstalled = profileVersionIsInstalled(versions, gameVersion, loader);
  const mods = addProjectIdsToFiles(unindexedMods, modInstalls);
  const resourcePacks = addProjectIdsToFiles(unindexedResourcePacks, resourcePackInstalls);
  const shaderPacks = addProjectIdsToFiles(unindexedShaderPacks, shaderPackInstalls);
  return {
    ...settings,
    gameVersion,
    loader,
    selectedCustomProfileId: customProfile?.id ?? null,
    maxCustomMemoryMb: getMaxCustomMemoryMb(),
    platform: process.platform,
    gameDirectory,
    gameRunning: activeGameSessions.size > 0,
    version: app.getVersion(),
    displayVersion: DISPLAY_VERSION,
    microsoftAuthConfigured: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      process.env.MINECRAFT_KIT_MSA_CLIENT_ID || 'bcfe67e2-a947-4621-a650-81db09205316'
    ),
    loaderInstalled,
    fabricInstalled: loader === 'fabric' && loaderInstalled,
    westronModSupported: loader === 'fabric' && gameVersion === GAME_VERSION,
    javaAvailable,
    mods,
    resourcePacks,
    shaderPacks,
    resourcePackProjects: Object.keys(resourcePackInstalls),
    shaderProjects: Object.keys(shaderPackInstalls),
    modrinthModProjects: Object.keys(modInstalls),
    performanceMode: performanceProfile.mode,
    performanceShaderEnabled: performanceProfile.mode === 'quality' && performanceProfile.includesShader,
    menuModInstalled: loader === 'fabric' && gameVersion === GAME_VERSION
      && mods.some((mod) => mod.name === `westron-launcher-${RELEASE_VERSION}.jar`),
  };
}

async function findJava(minecraftDir) {
  const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';
  const cachedJavaPath = javaPathCache.get(minecraftDir);
  if (cachedJavaPath) {
    if (!path.isAbsolute(cachedJavaPath)) return cachedJavaPath;
    try {
      await fs.access(cachedJavaPath);
      return cachedJavaPath;
    } catch {
      javaPathCache.delete(minecraftDir);
    }
  }
  const cacheJavaPath = (javaPath) => {
    javaPathCache.set(minecraftDir, javaPath);
    return javaPath;
  };
  const candidates = [process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', javaExecutable) : '']
    .filter(Boolean);
  const runtimeDir = path.join(minecraftDir, 'runtime');
  const pendingDirectories = [runtimeDir];
  while (pendingDirectories.length > 0) {
    const currentDirectories = pendingDirectories.splice(0, 8);
    const directoryEntries = await Promise.all(currentDirectories.map(async (directory) => {
      try {
        return await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    }));
    const nextDirectories = [];
    for (let directoryIndex = 0; directoryIndex < currentDirectories.length; directoryIndex += 1) {
      for (const entry of directoryEntries[directoryIndex]) {
        const entryPath = path.join(currentDirectories[directoryIndex], entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === javaExecutable) return cacheJavaPath(entryPath);
        if (entry.isDirectory()) nextDirectories.push(entryPath);
      }
    }
    pendingDirectories.push(...nextDirectories);
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
      if (available) return cacheJavaPath(candidate);
      continue;
    }
    try {
      await fs.access(candidate);
      return cacheJavaPath(candidate);
    } catch {
      // Continue to PATH lookup.
    }
  }
  return '';
}

async function installBundledMenu(minecraftDir) {
  const jarName = `westron-launcher-${RELEASE_VERSION}.jar`;
  const legacyJarNames = [
    'westron-client-skin-1.0.jar',
    'westron-client-skin-1.0.0.jar',
    'westron-client-skin-1.0.1.jar',
    'westron-client-skin-1.0.2.jar',
    'westron-client-skin-1.0.3.jar',
    'westron-client-skin-1.0.4.jar',
    'westron-client-menu-1.0.0.jar',
    'nocturne-menu-1.0.0.jar',
  ];
  const sourcePath = app.isPackaged
    ? path.join(process.resourcesPath, jarName)
    : path.join(__dirname, '..', 'fabric-mod', 'build', 'libs', jarName);
  try {
    await fs.access(sourcePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Westron Launcher bulunamadı. Önce `npm run build:mod` komutunu çalıştırın.');
    }
    throw error;
  }
  const modsDir = getModsDir(minecraftDir);
  await fs.mkdir(modsDir, { recursive: true });
  await fs.copyFile(sourcePath, path.join(modsDir, jarName));
  await Promise.all(legacyJarNames.map((legacyJarName) =>
    fs.rm(path.join(modsDir, legacyJarName), { force: true })));
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

async function resolveGameTarget(minecraftDir, gameVersion, loader, customProfile = null) {
  const { kit, Loaders, asMinecraftVersionId } = await getMinecraftKit();
  const target = await kit.targets.resolve({
    id: customProfile ? `westron-custom-${customProfile.id}` : `westron-client-${gameVersion}-${loader}`,
    directory: customProfile?.directory ?? getInstanceDir(minecraftDir, gameVersion, loader),
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
    const customProfile = state.customProfiles.find((profile) => profile.id === state.selectedCustomProfileId) ?? null;
    const { kit, target } = await resolveGameTarget(state.minecraftDir, state.gameVersion, state.loader, customProfile);
    await fs.mkdir(state.gameDirectory, { recursive: true });
    const plan = await kit.install.plan(target);
    await runMinecraftInstallWithProgress(kit, plan);
  }
  if (state.westronModSupported && !state.menuModInstalled) {
    await installBundledMenu(state.gameDirectory);
  }
  return `Minecraft ${state.gameVersion} ${state.loader} profili hazır.`;
}

async function installFabric() {
  const state = await getState();
  if (state.loader !== 'fabric' || state.gameVersion !== GAME_VERSION) {
    throw new Error('Bu işlem yalnızca Minecraft 26.3 Fabric profili için kullanılabilir.');
  }
  const customProfile = state.customProfiles.find((profile) => profile.id === state.selectedCustomProfileId) ?? null;
  const { kit, target } = await resolveGameTarget(state.minecraftDir, state.gameVersion, state.loader, customProfile);
  const plan = await kit.install.plan(target);
  const { DownloadCategories } = await getMinecraftKit();
  await runMinecraftInstallWithProgress(kit, plan, {
    actionCategories: new Set([
      DownloadCategories.FABRIC_LIBRARY,
      DownloadCategories.RUNTIME_FILE,
    ]),
  });
  await installBundledMenu(state.gameDirectory);
  return `Fabric ${state.gameVersion} ve Westron Launcher kuruldu.`;
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
  const customProfile = state.customProfiles.find((profile) => profile.id === state.selectedCustomProfileId) ?? null;
  const { kit, target } = await resolveGameTarget(state.minecraftDir, state.gameVersion, state.loader, customProfile);
  const plan = await kit.install.plan(target);
  const { AuthModes } = await getMinecraftKit();
  await runMinecraftInstallWithProgress(kit, plan);
  if (state.westronModSupported && !state.menuModInstalled) {
    await installBundledMenu(state.gameDirectory);
  }
  await writeLocalSkinIdentity(state.gameDirectory, username);

  const composition = await kit.launch.compose(target, {
    auth: microsoftSession?.auth ?? { mode: AuthModes.OFFLINE, username },
    launcherName: 'Westron Launcher',
    launcherVersion: app.getVersion(),
    ...(customProfile ? {
      memory: {
        minMb: Math.min(1024, customProfile.memoryMb),
        maxMb: customProfile.memoryMb,
      },
    } : {}),
  });
  const session = kit.launch.run(composition);
  activeGameSessions.add(session);
  const gameBehavior = settings.gameBehavior;
  session.exited.then((exit) => {
    activeGameSessions.delete(session);
    if (exit.code !== 0 && !exit.aborted) {
      console.error(`Minecraft ${username} oturumuyla ${exit.code ?? exit.signal} koduyla kapandı.`);
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('app:game-exited', { username, ...exit });
      if (gameBehavior === 'hide-and-restore' && window !== voiceCallWindow) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    }
  });
  if (gameBehavior === 'hide-and-restore') {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window !== voiceCallWindow) window.hide();
    }
  } else if (gameBehavior === 'close-on-game-launch') {
    if (voiceCallActive) {
      shouldQuitAfterVoiceCall = true;
      mainWindowHiddenForVoiceCall = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    } else {
      app.quit();
    }
  }
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
  const response = await net.fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', {
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

async function searchModrinth(type, query, gameVersion, loader, offset = 0) {
  assertModrinthType(type);
  await assertKnownMinecraftVersion(gameVersion);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Arama sonuçlarının sayfa konumu geçersiz.');
  }
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
    offset: String(offset),
    index: 'downloads',
  });
  const response = await net.fetch(`https://api.modrinth.com/v2/search?${params}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Modrinth araması başarısız oldu (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.hits) || !Number.isSafeInteger(data.total_hits) || data.total_hits < 0) {
    throw new Error('Modrinth arama sonucu beklenen biçimde değil.');
  }
  const projects = data.hits.map((hit) => ({
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url || '',
    downloads: hit.downloads,
    categories: hit.categories,
  }));
  return { projects, totalHits: data.total_hits, offset };
}

async function getModrinthProjectMetadata(projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length > 500
    || projectIds.some((projectId) => typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId))) {
    throw new Error('Modrinth proje bilgisi isteği geçersiz.');
  }
  const metadata = {};
  const uniqueIds = [...new Set(projectIds)];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const ids = uniqueIds.slice(offset, offset + 100);
    if (!ids.length) continue;
    const response = await net.fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
      headers: modrinthHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Modrinth mod bilgileri alınamadı (${response.status}).`);
    const projects = await response.json();
    if (!Array.isArray(projects)) throw new Error('Modrinth mod bilgileri beklenen biçimde değil.');
    for (const project of projects) {
      if (typeof project?.id === 'string') {
        metadata[project.id] = {
          title: typeof project.title === 'string' ? project.title : '',
          iconUrl: typeof project.icon_url === 'string' ? project.icon_url : '',
          description: typeof project.description === 'string' ? project.description : '',
        };
      }
    }
  }
  return metadata;
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
  const response = await net.fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params}`, {
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
  const response = await net.fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Gerekli mod sürümü alınamadı (${response.status}).`);
  return response.json();
}

async function getProjectTitle(projectId) {
  const response = await net.fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`, {
    headers: modrinthHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mod bilgisi alınamadı (${response.status}).`);
  const project = await response.json();
  return project.title;
}

async function downloadModrinthFile(file, directory, expectedExtension, forceReinstall = false) {
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
    if (!forceReinstall && createHash('sha1').update(existing).digest('hex') === expectedSha1.toLowerCase()) {
      return { fileName: file.filename, installed: false };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const download = await net.fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
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
  if (!result) {
    throw new ModCompatibilityError(`Minecraft ${gameVersion} ${loader} ile uyumlu mod sürümü bulunamadı.`);
  }

  const modsDir = getModsDir(state.gameDirectory);
  await fs.mkdir(modsDir, { recursive: true });
  return { plan: result.plan, modsDir };
}

async function installMod(projectId, gameVersion, loader, selectedVersionId = null, confirmedDependencyIds = null, forceReinstall = false) {
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
      if (forceReinstall || typeof expectedSha1 !== 'string'
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
    const result = await downloadModrinthFile(file, modsDir, '.jar', forceReinstall);
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
    projectIds: [...new Set(filesToInstall.map((item) => item.projectId))],
    managedFiles: filesToInstall.map(({ file, projectId }) => ({ projectId, fileName: file.filename })),
    cancelled: false,
    dependencies: requiredMods.map((item) => item.title),
  };
}

async function installPerformanceProject(project, gameVersion, loader) {
  let result = await installMod(project.id, gameVersion, loader);
  if (result.status === 'confirmation-required') {
    result = await installMod(
      project.id,
      gameVersion,
      loader,
      null,
      result.dependencies.map((dependency) => dependency.projectId),
    );
  }
  if (result.status !== 'installed') throw new Error(`"${project.title}" kurulumu tamamlanamadı.`);
  return result;
}

async function installPerformancePreset(mode, includeShader) {
  if (!['default', 'performance', 'quality'].includes(mode) || typeof includeShader !== 'boolean') {
    throw new Error('Westron Launcher modu seçimi geçersiz.');
  }
  if (includeShader && mode !== 'quality') {
    throw new Error('Shader yalnızca Ultra Kalite modunda etkinleştirilebilir.');
  }
  const state = await getState();
  if (state.gameRunning) return { installed: [], skipped: [], blocked: 'game-running' };

  const previousProfile = await readPerformanceProfile(state.gameDirectory);
  if (mode === 'default') {
    await removePerformanceManagedFiles(state.gameDirectory, previousProfile.managedFiles);
    await writePerformanceProfile(state.gameDirectory, defaultPerformanceProfile());
    return { installed: [], skipped: [] };
  }
  if (!['fabric', 'forge'].includes(state.loader)) {
    throw new Error('Performans ve kalite modları için Fabric veya Forge seçin.');
  }
  if (includeShader && state.loader !== 'fabric') {
    throw new Error('Shader yalnızca Fabric profillerinde kullanılabilir.');
  }
  if (!state.loaderInstalled) {
    throw new Error(`Önce Minecraft ${state.gameVersion} ${state.loader} profilini kurun.`);
  }

  const modsDirectory = getModsDir(state.gameDirectory);
  const shaderDirectory = getContentDirectory(state.gameDirectory, 'shader');
  const existingModInstalls = await readInstallIndex(modsDirectory, '.jar');
  const existingShaderInstalls = await readInstallIndex(shaderDirectory, '.zip');
  const previouslyManaged = new Set(previousProfile.managedFiles.map((file) => `${file.type}:${file.projectId}`));
  const nextManagedFiles = [];
  const installed = [];
  const skipped = [];
  let irisAvailable = false;
  let shaderEnabled = false;
  const projects = getPerformancePresetProjects(mode, state.loader);
  if (mode === 'quality' && includeShader) projects.push(SHADER_LOADER);

  for (const project of projects) {
    try {
      const result = await installPerformanceProject(project, state.gameVersion, state.loader);
      installed.push(project.title);
      if (project.id === SHADER_LOADER.id) irisAvailable = true;
      for (const file of result.managedFiles) {
        if (!existingModInstalls[file.projectId] || previouslyManaged.has(`mod:${file.projectId}`)) {
          nextManagedFiles.push({ type: 'mod', ...file });
        }
      }
    } catch (error) {
      if (!(error instanceof ModCompatibilityError)) throw error;
      skipped.push(project.title);
    }
  }

  if (mode === 'quality' && includeShader && irisAvailable) {
    try {
      const result = await installModrinthPack('shader', QUALITY_SHADER.id, state.gameVersion, null);
      installed.push(QUALITY_SHADER.title);
      shaderEnabled = true;
      if (!existingShaderInstalls[QUALITY_SHADER.id] || previouslyManaged.has(`shader:${QUALITY_SHADER.id}`)) {
        nextManagedFiles.push({ type: 'shader', projectId: QUALITY_SHADER.id, fileName: result.fileName });
      }
    } catch (error) {
      if (!(error instanceof ModCompatibilityError)) throw error;
      skipped.push(QUALITY_SHADER.title);
    }
  } else if (mode === 'quality' && includeShader) {
    skipped.push(QUALITY_SHADER.title);
  }

  if (installed.length === 0) {
    throw new ModCompatibilityError(
      `Minecraft ${state.gameVersion} ${state.loader} profili için uyumlu performans/kalite modları bulunamadı. Fabric profiliyle tekrar deneyin.`,
    );
  }

  const uniqueManagedFiles = [...new Map(nextManagedFiles.map((file) => [`${file.type}:${file.projectId}`, file])).values()];
  const retainedFiles = new Map(uniqueManagedFiles.map((file) => [`${file.type}:${file.projectId}`, file.fileName]));
  const filesToRemove = previousProfile.managedFiles.filter((file) =>
    retainedFiles.get(`${file.type}:${file.projectId}`) !== file.fileName);
  await removePerformanceManagedFiles(state.gameDirectory, filesToRemove);
  await writePerformanceProfile(state.gameDirectory, {
    mode,
    includesShader: shaderEnabled,
    managedFiles: uniqueManagedFiles,
  });
  return { installed, skipped };
}

async function installModrinthPack(type, projectId, gameVersion, selectedVersionId, forceReinstall = false) {
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
    throw new ModCompatibilityError(`Minecraft ${gameVersion} ile uyumlu ${label} sürümü bulunamadı.`);
  }
  const file = version.files?.find((item) => item.primary && item.filename?.toLowerCase().endsWith('.zip'))
    || version.files?.find((item) => item.filename?.toLowerCase().endsWith('.zip'));
  if (!file) throw new ModCompatibilityError('Bu Modrinth sürümünde indirilebilir ZIP dosyası bulunamadı.');
  const directory = getContentDirectory((await getState()).gameDirectory, type);
  const installIndex = await readInstallIndex(directory, '.zip');
  const result = await downloadModrinthFile(file, directory, '.zip', forceReinstall);
  await persistInstalledFiles(directory, '.zip', installIndex, [{ projectId, fileName: result.fileName }]);
  return {
    status: result.installed ? 'installed' : 'already-installed',
    fileName: result.fileName,
    projectId,
    managedFile: { projectId, fileName: result.fileName },
    versionNumber: version.version_number,
  };
}

function broadcastVoiceCallWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:voice-call-window-state', {
    open: Boolean(voiceCallWindow && !voiceCallWindow.isDestroyed()),
    visible: Boolean(voiceCallWindow && !voiceCallWindow.isDestroyed()
      && !voiceCallWindow.isMinimized() && voiceCallWindow.isVisible()),
    minimized: Boolean(voiceCallWindow && !voiceCallWindow.isDestroyed() && voiceCallWindow.isMinimized()),
    opening: Boolean(voiceCallWindow && !voiceCallWindow.isDestroyed() && !voiceCallWindowReady),
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function closeVoiceCallWindow() {
  const window = voiceCallWindow;
  if (!window || window.isDestroyed()) {
    voiceCallWindow = null;
    voiceCallWindowReady = false;
    broadcastVoiceCallWindowState();
    return;
  }
  isClosingVoiceCallWindow = true;
  window.close();
  isClosingVoiceCallWindow = false;
}

function updateVoiceCallWindowState(input, participants) {
  const call = input?.call && typeof input.call === 'object' ? input.call : {};
  const activeCall = participants.length > 0 && call.incoming !== true;
  const safeLabel = (value) => typeof value === 'string' ? value.slice(0, 100) : '';
  const safeImageUrl = (value) => {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href.slice(0, 2048) : '';
    } catch {
      return '';
    }
  };
  voiceCallWindowState = {
    active: activeCall,
    incoming: call.incoming === true,
    self: safeLabel(call.self),
    selfSkinUrl: safeImageUrl(call.selfSkinUrl),
    selfSpeaking: call.selfSpeaking === true,
    friend: safeLabel(call.friend),
    status: safeLabel(call.status),
    avatarShape: call.avatarShape === 'square' ? 'square' : 'round',
    friendSkinUrl: safeImageUrl(call.friendSkinUrl),
    groupParticipants: Array.isArray(call.groupParticipants)
      ? call.groupParticipants.slice(0, 15).map((participant) => ({
        username: safeLabel(participant?.username),
        skinUrl: safeImageUrl(participant?.skinUrl),
        connected: participant?.connected === true,
        speaking: participant?.speaking === true,
        microphoneMuted: participant?.microphoneMuted === true,
        speakerMuted: participant?.speakerMuted === true,
      })).filter((participant) => participant.username)
      : [],
    microphoneMuted: call.microphoneMuted === true,
    remoteAudioMuted: call.remoteAudioMuted === true,
    friendMicrophoneMuted: call.friendMicrophoneMuted === true,
    friendSpeakerMuted: call.friendSpeakerMuted === true,
    canAddParticipant: call.canAddParticipant === true,
    speaking: Array.isArray(input?.speaking) && input.speaking.includes(safeLabel(call.friend)),
    labels: call.labels && typeof call.labels === 'object'
      ? Object.fromEntries(Object.entries(call.labels).map(([key, value]) => [key, safeLabel(value)]))
      : {},
  };
  if (!activeCall) {
    closeVoiceCallWindow();
    if (mainWindowHiddenForVoiceCall) {
      mainWindowHiddenForVoiceCall = false;
      if (shouldQuitAfterVoiceCall) {
        shouldQuitAfterVoiceCall = false;
        app.quit();
      } else {
        showMainWindow();
      }
    }
    return;
  }
  if (!voiceCallWindow || voiceCallWindow.isDestroyed()) {
    voiceCallWindowReady = false;
    voiceCallWindow = new BrowserWindow({
      width: 760,
      height: 500,
      minWidth: 560,
      minHeight: 420,
      frame: false,
      show: false,
      alwaysOnTop: true,
      backgroundColor: '#0b0d11',
      title: 'Westron Voice Call',
      icon: launcherIcon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'voice-call-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const window = voiceCallWindow;
    if (launcherIcon) window.setIcon(launcherIcon);
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`Voice call preload failed (${path.basename(preloadPath)}): ${error.message}`);
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`Voice call window navigation failed (${errorCode}): ${errorDescription}; ${validatedURL}`);
    });
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        console.error(`Voice call renderer error (${path.basename(details.sourceId)}:${details.lineNumber}): ${details.message}`);
      }
    });
    window.webContents.on('did-finish-load', () => {
      if (voiceCallWindowState && !window.isDestroyed()) {
        window.webContents.send('app:voice-call-state', voiceCallWindowState);
      }
    });
    window.on('minimize', broadcastVoiceCallWindowState);
    window.on('restore', broadcastVoiceCallWindowState);
    window.on('show', broadcastVoiceCallWindowState);
    window.on('hide', broadcastVoiceCallWindowState);
    window.on('close', (event) => {
      if (isClosingVoiceCallWindow || appIsQuitting) return;
      event.preventDefault();
      window.hide();
      if (mainWindowHiddenForVoiceCall) showMainWindow();
    });
    window.on('closed', () => {
      if (voiceCallWindow === window) {
        voiceCallWindow = null;
        voiceCallWindowReady = false;
      }
      broadcastVoiceCallWindowState();
    });
    window.loadFile(path.join(__dirname, 'voice-call.html')).catch((error) => {
      console.error(`Could not load the voice call window: ${error.message}`);
    });
    window.once('ready-to-show', () => {
      voiceCallWindowReady = true;
      if (!window.isDestroyed() && voiceCallWindowState?.active) window.show();
      broadcastVoiceCallWindowState();
    });
  } else if (!voiceCallWindow.webContents.isLoading()) {
    voiceCallWindow.webContents.send('app:voice-call-state', voiceCallWindowState);
  }
  broadcastVoiceCallWindowState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    backgroundColor: '#0b0d11',
    title: 'Westron Launcher',
    icon: launcherIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const window = mainWindow;
  if (launcherIcon) window.setIcon(launcherIcon);
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
      console.error(`Renderer console error (${path.basename(details.sourceId)}:${details.lineNumber}): ${details.message}`);
    }
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('app:update-status', updateStatus);
  });
  window.on('close', (event) => {
    if (voiceCallActive && !appIsQuitting) {
      event.preventDefault();
      mainWindowHiddenForVoiceCall = true;
      window.hide();
    }
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

function setupMediaPermissions() {
  const productionRendererUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = Boolean(BrowserWindow.fromWebContents(webContents))
      && canGrantAudioMediaPermission({
        permission,
        mediaTypes: details?.mediaTypes,
        url: webContents.getURL(),
        isDevelopment: process.env.NODE_ENV === 'development',
        productionRendererUrl,
      });
    callback(allowed);
  });
}

ipcMain.handle('app:state', getState);
ipcMain.handle('app:microsoft-account', () => microsoftAuth.getAccount());
ipcMain.handle('app:microsoft-sign-in', () => microsoftAuth.signIn());
ipcMain.handle('app:microsoft-cancel-sign-in', () => microsoftAuth.cancelSignIn());
ipcMain.handle('app:microsoft-sign-out', () => microsoftAuth.signOut());
ipcMain.handle('app:window-control', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) throw new Error('Uygulama penceresi artık kullanılamıyor.');
  if (action === 'minimize') {
    window.minimize();
    return;
  }
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return;
  }
  if (action === 'close') {
    window.close();
    return;
  }
  throw new Error('Pencere işlemi geçersiz.');
});
ipcMain.handle('app:show-westron-voice-call-window', (event) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) {
    throw new Error('Sesli arama penceresi bu uygulama penceresinden açılamaz.');
  }
  if (!voiceCallWindow || voiceCallWindow.isDestroyed()) {
    throw new Error('Açık bir sesli arama bulunmuyor.');
  }
  if (voiceCallWindow.isMinimized()) voiceCallWindow.restore();
  voiceCallWindow.show();
  voiceCallWindow.focus();
  broadcastVoiceCallWindowState();
});
ipcMain.handle('app:voice-call-window-control', (event, action) => {
  if (BrowserWindow.fromWebContents(event.sender) !== voiceCallWindow) {
    throw new Error('Sesli arama penceresi artık kullanılamıyor.');
  }
  if (action === 'minimize') {
    voiceCallWindow.minimize();
    return;
  }
  if (action === 'show-main') {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Westron Launcher penceresi artık kullanılamıyor.');
    }
    const mainWindowWasVisible = mainWindow.isVisible() && !mainWindow.isMinimized();
    showMainWindow();
    if (mainWindowWasVisible) mainWindow.webContents.send('app:highlight-main-window');
    return;
  }
  throw new Error('Sesli arama penceresi işlemi geçersiz.');
});
ipcMain.handle('app:voice-call-action', (event, action) => {
  if (BrowserWindow.fromWebContents(event.sender) !== voiceCallWindow) {
    throw new Error('Sesli arama penceresi artık kullanılamıyor.');
  }
  if (!['accept', 'reject', 'end', 'toggle-microphone', 'toggle-speaker', 'add-participant'].includes(action)) {
    throw new Error('Sesli arama işlemi geçersiz.');
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Westron Launcher penceresi artık kullanılamıyor.');
  }
  if (action === 'add-participant') {
    voiceCallWindow.hide();
    showMainWindow();
  }
  mainWindow.webContents.send('app:voice-call-action', action);
});
ipcMain.handle('app:choose-minecraft-dir', async () => {
  const settings = await readSettings();
  if (process.platform === 'win32') {
    const targetMinecraftDir = getDefaultMinecraftDir();
    await fs.mkdir(path.join(targetMinecraftDir, 'westron-profiles'), { recursive: true });
    await saveSettings({ ...settings, minecraftDir: targetMinecraftDir });
  } else {
    const result = await dialog.showOpenDialog({
      title: 'Minecraft klasörünü seç',
      defaultPath: settings.minecraftDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return getState();
    await saveSettings({ ...settings, minecraftDir: result.filePaths[0] });
  }
  return getState();
});
ipcMain.handle('app:choose-custom-profile-directory', async () => {
  const settings = await readSettings();
  const result = await dialog.showOpenDialog({
    title: 'Özel profil klasörünü seç',
    defaultPath: settings.minecraftDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});
ipcMain.handle('app:open-profiles-folder', async () => {
  const { minecraftDir } = await readSettings();
  const directory = path.join(minecraftDir, 'westron-profiles');
  await fs.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(`Westron Profiles klasörü açılamadı: ${error}`);
});
ipcMain.handle('app:open-selected-profile-folder', async () => {
  const { gameDirectory } = await getState();
  await fs.mkdir(gameDirectory, { recursive: true });
  const error = await shell.openPath(gameDirectory);
  if (error) throw new Error(`Seçili oyun profili klasörü açılamadı: ${error}`);
});
ipcMain.handle('app:save-game-behavior', async (_event, behavior) => {
  if (!['close-on-game-launch', 'stay-open', 'hide-and-restore'].includes(behavior)) {
    throw new Error('Westron Launcher davranışı geçersiz.');
  }
  const settings = await readSettings();
  await saveSettings({ ...settings, gameBehavior: behavior });
  return getState();
});
ipcMain.handle('app:game-versions', getMinecraftVersions);
ipcMain.handle('app:set-title-bar-theme', (_event, theme, performanceMode, performanceThemeEnabled) => {
  if (theme !== 'dark' && theme !== 'light') throw new Error('Arayüz teması geçersiz.');
  if (!['default', 'performance', 'quality'].includes(performanceMode)) {
    throw new Error('Performans teması geçersiz.');
  }
  if (typeof performanceThemeEnabled !== 'boolean') {
    throw new Error('Performans teması seçimi geçersiz.');
  }
});
ipcMain.handle('app:select-custom-profile', async (_event, profileId) => {
  if (profileId !== null && typeof profileId !== 'string') {
    throw new Error('Seçilen özel profil geçersiz.');
  }
  const settings = await readSettings();
  if (profileId && !settings.customProfiles.some((profile) => profile.id === profileId)) {
    throw new Error('Seçilen özel profil bulunamadı.');
  }
  await saveSettings({ ...settings, selectedCustomProfileId: profileId || null });
  return getState();
});
ipcMain.handle('app:create-custom-profile', async (_event, input) => {
  const settings = await readSettings();
  const maxMemoryMb = getMaxCustomMemoryMb();
  const fields = validateCustomProfileFields(input, maxMemoryMb);
  await assertValidGameOptions(fields.gameVersion, fields.loader);

  const id = randomUUID();
  const directory = fields.directory || path.join(
    settings.minecraftDir,
    'westron-profiles',
    'custom',
    id,
  );
  if (isStandardProfileDirectory(directory, settings.minecraftDir)) {
    throw new Error('Özel profil için standart oyun profillerinden farklı bir klasör seçin.');
  }
  assertUniqueCustomProfileDirectory(directory, settings.customProfiles);
  const profile = { id, ...fields, directory: path.resolve(directory) };
  await fs.mkdir(profile.directory, { recursive: true });
  await saveSettings({
    ...settings,
    customProfiles: [...settings.customProfiles, profile],
    selectedCustomProfileId: id,
  });
  return getState();
});
ipcMain.handle('app:update-custom-profile', async (_event, profileId, input) => {
  if (typeof profileId !== 'string') throw new Error('Özel profil kimliği geçersiz.');
  const settings = await readSettings();
  const currentProfile = settings.customProfiles.find((profile) => profile.id === profileId);
  if (!currentProfile) throw new Error('Düzenlenecek özel profil bulunamadı.');

  const fields = validateCustomProfileFields(
    { ...input, directory: currentProfile.directory },
    Math.max(getMaxCustomMemoryMb(), currentProfile.memoryMb),
  );
  await assertValidGameOptions(fields.gameVersion, fields.loader);
  const customProfiles = settings.customProfiles.map((profile) =>
    profile.id === profileId ? { id: profileId, ...fields, directory: currentProfile.directory } : profile,
  );
  await saveSettings({ ...settings, customProfiles });
  return getState();
});
ipcMain.handle('app:delete-custom-profile', async (_event, profileId, deleteFiles) => {
  if (typeof profileId !== 'string' || typeof deleteFiles !== 'boolean') {
    throw new Error('Özel profil silme isteği geçersiz.');
  }
  const settings = await readSettings();
  const profile = settings.customProfiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error('Silinecek özel profil bulunamadı.');

  let stagedDirectory = null;
  if (deleteFiles) {
    if (activeGameSessions.size > 0) {
      throw new Error('Oyun çalışırken profil dosyaları silinemez.');
    }

    let actualDirectory;
    try {
      actualDirectory = await fs.realpath(profile.directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      actualDirectory = null;
    }
    if (actualDirectory) {
      const directoryInfo = await fs.lstat(profile.directory);
      if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
        throw new Error('Profil klasörü gerçek bir klasör değil; dosyalar güvenli şekilde silinemez.');
      }
      if (isStandardProfileDirectory(actualDirectory, settings.minecraftDir)) {
        throw new Error('Bu klasör güvenli şekilde silinemez; başka bir profil veya önemli klasörle çakışıyor.');
      }
      const existingProfiles = await Promise.all(settings.customProfiles.map(async (entry) => {
        if (entry.id === profileId) return entry;
        try {
          return { ...entry, directory: await fs.realpath(entry.directory) };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return entry;
        }
      }));
      assertSafeCustomProfileDeletion(actualDirectory, {
        homeDirectory: app.getPath('home'),
        minecraftDir: settings.minecraftDir,
        profiles: existingProfiles,
        profileId,
      });
      stagedDirectory = path.join(path.dirname(profile.directory), `.westron-profile-delete-${randomUUID()}`);
      await fs.rename(profile.directory, stagedDirectory);
    }
  }

  const nextSettings = {
    ...settings,
    customProfiles: settings.customProfiles.filter((entry) => entry.id !== profileId),
    selectedCustomProfileId: settings.selectedCustomProfileId === profileId
      ? null
      : settings.selectedCustomProfileId,
  };
  try {
    await saveSettings(nextSettings);
  } catch (error) {
    if (stagedDirectory) {
      try {
        await fs.rename(stagedDirectory, profile.directory);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Profil ayarları kaydedilemedi ve oyun klasörü eski konumuna geri alınamadı.',
        );
      }
    }
    throw error;
  }

  let cleanupError = null;
  if (stagedDirectory) {
    try {
      await fs.rm(stagedDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Özel profil klasörü silinemedi: ${profile.name}`, error);
      cleanupError = error.message;
    }
  }
  return { state: await getState(), cleanupError };
});
ipcMain.handle('app:save-game-options', async (_event, gameVersion, loader, confirmNewProfile = false, dismissNotice = false) => {
  await assertValidGameOptions(gameVersion, loader);
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
    selectedCustomProfileId: null,
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
  return 'Westron Launcher kuruldu.';
});
ipcMain.handle('app:search-mods', async (_event, query, offset = 0) => {
  const state = await getState();
  return searchModrinth('mod', String(query || '').slice(0, 100), state.gameVersion, state.loader, offset);
});
ipcMain.handle('app:search-content', async (_event, type, query, offset = 0) => {
  const state = await getState();
  return searchModrinth(String(type), String(query || '').slice(0, 100), state.gameVersion, state.loader, offset);
});
ipcMain.handle('app:project-versions', async (_event, type, projectId) => {
  const state = await getState();
  const versions = await getProjectVersions(
    String(projectId),
    String(type),
    state.gameVersion,
    state.loader,
  );
  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber ?? version.version_number,
    name: version.name,
    datePublished: version.datePublished ?? version.date_published,
    gameVersions: version.gameVersions ?? version.game_versions,
    loaders: version.loaders,
  }));
});
ipcMain.handle('app:project-metadata', (_event, projectIds) =>
  getModrinthProjectMetadata(projectIds));
ipcMain.handle('app:mod-archive-metadata', async (_event, fileNames) => {
  const state = await getState();
  return getModArchiveMetadata(getModsDir(state.gameDirectory), fileNames);
});
ipcMain.handle('app:install-mod', async (_event, projectId, selectedVersionId, confirmedDependencyIds, forceReinstall = false) => {
  const state = await getState();
  const result = await installMod(
    String(projectId),
    state.gameVersion,
    state.loader,
    typeof selectedVersionId === 'string' ? selectedVersionId : null,
    confirmedDependencyIds,
    forceReinstall === true,
  );
  if (result.status === 'installed') {
    await forgetPerformanceProjects(state.gameDirectory, result.projectIds);
  }
  return result;
});
ipcMain.handle('app:install-content', async (_event, type, projectId, selectedVersionId, forceReinstall = false) => {
  const state = await getState();
  const result = await installModrinthPack(
    String(type),
    String(projectId),
    state.gameVersion,
    typeof selectedVersionId === 'string' ? selectedVersionId : null,
    forceReinstall === true,
  );
  if (type === 'shader') {
    await forgetPerformanceProjects(state.gameDirectory, [String(projectId)], 'shader');
  }
  return result;
});
ipcMain.handle('app:install-performance-preset', (_event, mode, includeShader) =>
  installPerformancePreset(mode, includeShader));
ipcMain.handle('app:update-status', () => updateStatus);
ipcMain.handle('app:check-for-updates', checkForUpdates);
ipcMain.handle('app:download-update', downloadUpdate);
ipcMain.handle('app:publish-update', async () => {
  const credentials = await readWestronAuth();
  if (!credentials?.account || credentials.account.email?.trim().toLowerCase() !== 'ermiscaner78@gmail.com'
    || credentials.account.emailVerified !== true) {
    throw new Error('Güncelleme yayımlamak için doğrulanmış yayıncı Westron hesabıyla giriş yapın.');
  }
  const result = await dialog.showOpenDialog({
    title: 'Derlenmiş Westron Launcher sürüm klasörünü seç',
    defaultPath: path.join(__dirname, '..', 'release'),
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  const files = await readUpdateFiles(result.filePaths[0]);
  const currentCredentials = await readWestronAuth();
  if (!currentCredentials?.account || currentCredentials.account.email?.trim().toLowerCase() !== 'ermiscaner78@gmail.com'
    || currentCredentials.account.emailVerified !== true) {
    throw new Error('Yayın öncesinde Westron yayıncı hesabının oturumu doğrulanamadı.');
  }
  for (const file of [files.installer, files.blockmap, files.manifest]) {
    const upload = (token) => westronApi.updateAsset(file.name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.westron.update' },
      body: file.contents,
      accessToken: token,
      timeoutMs: null,
    });
    try {
      await upload(currentCredentials.accessToken);
    } catch (error) {
      if (error.status !== 401) throw error;
      const renewed = await refreshWestronAuth(currentCredentials);
      await upload(renewed.accessToken);
    }
  }
  return { cancelled: false, version: packageJson.version };
});
ipcMain.handle('app:install-update', () => {
  if (updateStatus.status !== 'downloaded') throw new Error('Önce güncelleme indirilmelidir.');
  autoUpdater.quitAndInstall(false, true);
});
ipcMain.handle('app:list-screenshots', async () => {
  const { gameDirectory } = await getState();
  return listScreenshots(gameDirectory, (filePath) => {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return '';
    return image.resize({ width: 640, height: 360, quality: 'best' }).toDataURL();
  });
});
ipcMain.handle('app:list-screenshots-page', async (_event, offset, limit) => {
  const { gameDirectory } = await getState();
  return listScreenshots(gameDirectory, (filePath) => {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return '';
    return image.resize({ width: 640, height: 360, quality: 'best' }).toDataURL();
  }, { offset, limit });
});
ipcMain.handle('app:read-screenshot', async (_event, fileName) => {
  const { gameDirectory } = await getState();
  return readScreenshot(gameDirectory, fileName);
});
ipcMain.handle('app:delete-screenshot', async (_event, fileName) => {
  const { gameDirectory } = await getState();
  await deleteScreenshot(gameDirectory, fileName);
});
ipcMain.handle('app:open-screenshots-folder', async () => {
  const { gameDirectory } = await getState();
  const directory = getScreenshotsDirectory(gameDirectory);
  await fs.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(`Ekran görüntüsü klasörü açılamadı: ${error}`);
});
ipcMain.handle('app:download-screenshot', async (_event, fileName) => {
  const { gameDirectory } = await getState();
  const sourcePath = resolveScreenshotPath(gameDirectory, fileName);
  const destination = path.join(app.getPath('downloads'), fileName);
  await fs.copyFile(sourcePath, destination);
  return { cancelled: false, path: destination };
});
ipcMain.handle('app:choose-send-westron-photo', async (_event, input) => {
  const selection = await dialog.showOpenDialog({
    title: 'Tek kullanımlık fotoğraf seç',
    properties: ['openFile'],
    filters: [{ name: 'PNG fotoğraf', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  return westronSendPhotoMessage({
    recipientUserId: input?.recipientUserId,
    filePath: selection.filePaths[0],
  }).then((result) => ({ cancelled: false, ...result }));
});
ipcMain.handle('app:share-screenshot-to-friends', async (_event, input) => {
  if (!Array.isArray(input?.recipientUserIds) || input.recipientUserIds.length === 0) {
    throw new Error('Gönderilecek arkadaş seçilmedi.');
  }
  if (input.recipientUserIds.some((userId) =>
    typeof userId !== 'string' || !userId.trim() || userId.length > 64)) {
    throw new Error('Arkadaş hesap bilgisi geçersiz.');
  }
  const { gameDirectory } = await getState();
  const filePath = resolveScreenshotPath(gameDirectory, input.fileName);
  await fs.stat(filePath);
  const screenshot = await prepareWestronScreenshot(filePath);
  const recipientUserIds = [...new Set(input.recipientUserIds)];
  for (let index = 0; index < recipientUserIds.length; index += 3) {
    await Promise.all(recipientUserIds.slice(index, index + 3).map((recipientUserId) =>
      westronSendPhotoMessage({ recipientUserId, ...screenshot })));
  }
  return { sent: true };
});
ipcMain.handle('app:share-screenshot-to-groups', async (_event, input) => {
  if (!Array.isArray(input?.groupIds) || input.groupIds.length === 0
    || input.groupIds.some((groupId) => typeof groupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(groupId))) {
    throw new Error('Gönderilecek grup seçilmedi veya grup bilgisi geçersiz.');
  }
  const { gameDirectory } = await getState();
  const filePath = resolveScreenshotPath(gameDirectory, input.fileName);
  await fs.stat(filePath);
  const screenshot = await prepareWestronScreenshot(filePath);
  const groupIds = [...new Set(input.groupIds)];
  for (let index = 0; index < groupIds.length; index += 3) {
    await Promise.all(groupIds.slice(index, index + 3).map((groupId) =>
      westronSendGroupPhoto({ groupId, ...screenshot })));
  }
  return { sent: true };
});
ipcMain.handle('app:westron-recall-message', async (_event, input) => westronRecallMessage(input));
ipcMain.handle('app:update-westron-voice-overlay', async (_event, input) => {
  if (!input || !Array.isArray(input.participants)
    || input.participants.some((participant) => typeof participant !== 'string')) {
    throw new Error('Sesli arama katılımcıları geçersiz.');
  }
  const participants = input.participants.slice(0, 16).map((participant) => participant.slice(0, 64));
  const speaking = Array.isArray(input.speaking)
    ? input.speaking.filter((participant) => typeof participant === 'string').slice(0, 16)
    : [];
  voiceCallActive = participants.length > 0 && input?.call?.incoming !== true;
  updateVoiceCallWindowState(input, participants);
  const { gameDirectory } = await getState();
  const overlayDirectory = path.join(gameDirectory, 'westron-voice');
  await fs.mkdir(overlayDirectory, { recursive: true });
  await fs.writeFile(path.join(overlayDirectory, 'overlay.json'), JSON.stringify({
    enabled: input?.enabled === true,
    participants,
    speaking,
  }), 'utf8');
});
ipcMain.handle('app:play-westron-notification', (_event, kind) => {
  if (process.platform === 'win32') {
    shell.beep();
  }
  return { played: true };
});
ipcMain.handle('app:show-westron-notification', (_event, input) => {
  if (!input || typeof input.sender !== 'string' || input.sender.length > 64
    || typeof input.message !== 'string' || input.message.length > 180
    || (input.notificationId !== undefined
      && (typeof input.notificationId !== 'string' || input.notificationId.length > 128))) {
    throw new Error('Westron bildirimi geçersiz.');
  }
  if (!Notification.isSupported()) return { shown: false };
  const notification = new Notification({
    title: 'Westron Launcher',
    body: `${input.sender}: ${input.message}`,
    silent: true,
  });
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('app:open-friends', input.notificationId ?? null);
  });
  notification.show();
  return { shown: true };
});
ipcMain.handle('app:get-minecraft-skin-url', async (_event, input) => {
  try {
    return await getMinecraftSkinUrl(input?.username);
  } catch (error) {
    console.warn(`Minecraft skin lookup failed: ${error.message}`);
    return null;
  }
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
  uploadElytra: westronUploadElytra,
  deleteElytra: westronDeleteElytra,
  logout: westronLogout,
  listFriends: westronListFriends,
  getFriendSkinUrl: westronGetFriendSkinUrl,
  searchFriends: westronSearchFriends,
  sendFriendRequest: westronSendFriendRequest,
  respondFriendRequest: westronRespondToFriendRequest,
  cancelFriendRequest: westronCancelFriendRequest,
  removeFriend: westronRemoveFriend,
  listGroups: westronListGroups,
  createGroup: westronCreateGroup,
  renameGroup: westronRenameGroup,
  deleteGroup: westronDeleteGroup,
  removeGroupMember: westronRemoveGroupMember,
  listGroupConversation: westronListGroupConversation,
  sendGroupMessage: westronSendGroupMessage,
  getGroupMessagePhoto: westronGetGroupMessagePhoto,
  sendGroupPhoto: westronChooseAndSendGroupPhoto,
  updatePresence: westronUpdatePresence,
  sendEphemeralMessage: westronSendEphemeralMessage,
  listEphemeralMessages: westronListEphemeralMessages,
  listConversation: westronListConversation,
  getMessagePhoto: westronGetMessagePhoto,
  consumeEphemeralMessage: westronConsumeEphemeralMessage,
  getVoiceCallIceServers: westronGetVoiceCallIceServers,
  sendVoiceCallSignal: westronSendVoiceCallSignal,
  consumeVoiceCallSignals: westronConsumeVoiceCallSignals,
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

app.on('before-quit', () => {
  appIsQuitting = true;
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  setupMediaPermissions();
  setupApplicationMenu();
  configureAutoUpdater();
  createWindow();
  if (canUseAutoUpdater()) {
    setTimeout(() => { void checkForUpdates(); }, 5000);
  }
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

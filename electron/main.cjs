const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, safeStorage, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createWestronApiClient, registerWestronIpcHandlers } = require('./westron-api.cjs');
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
const { getUpdateUploadTimeoutMs, readUpdateFiles } = require('./update-publisher.cjs');

const GAME_VERSION = '26.3';
const DISPLAY_VERSION = '1.0';
const UPDATE_PUBLISHER_EMAIL = 'ermiscaner78@gmail.com';
const westronApi = createWestronApiClient();
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const WESTRON_AUTH_FILE = () => path.join(app.getPath('userData'), 'westron-auth.bin');
const MICROSOFT_AUTH_FILE = () => path.join(app.getPath('userData'), 'microsoft-auth.bin');
let minecraftKitPromise;
let updateStatus = { status: 'idle', currentVersion: DISPLAY_VERSION, percent: 0 };
let updateCheckPromise = null;

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
    if (error.statusCode === 404 || /\b404\b/.test(error.message)) {
      publishUpdateStatus({
        status: 'up-to-date',
        version: DISPLAY_VERSION,
        message: 'Şu anda yeni bir güncelleme bulunmuyor.',
      });
      return updateStatus;
    }
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

function parseLocalUpdateManifest(buffer) {
  const manifest = buffer.toString('utf8');
  const version = manifest.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const fileName = manifest.match(/^  - url:\s*(Westron Client Setup 1\.0\.exe)\s*$/m)?.[1];
  const sha512 = manifest.match(/^    sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  if (!version?.startsWith('1.0.') || !fileName || !sha512) {
    throw new Error('latest.yml geçersiz veya setup dosyasıyla uyumsuz.');
  }
  return { fileName, sha512 };
}

async function publishUpdateFiles() {
  let credentials = await readWestronAuth();
  if (!credentials?.account?.emailVerified
    || credentials.account.email?.trim().toLowerCase() !== UPDATE_PUBLISHER_EMAIL) {
    throw new Error(`Güncelleme yayımlamak için doğrulanmış ${UPDATE_PUBLISHER_EMAIL} hesabıyla giriş yapın.`);
  }
  const selection = await dialog.showOpenDialog({
    title: 'Westron Client kurulum dosyalarıyla birlikte release klasörünü seç',
    buttonLabel: 'Release klasörünü seç',
    properties: ['openDirectory'],
  });
  if (selection.canceled) return { cancelled: true };

  const files = await readUpdateFiles(selection.filePaths[0]);
  const { installer, blockmap, manifest } = files;
  const { fileName: manifestFileName, sha512 } = parseLocalUpdateManifest(manifest.contents);
  if (installer.name !== manifestFileName
    || createHash('sha512').update(installer.contents).digest('base64') !== sha512
    || blockmap.contents.length === 0) {
    throw new Error('latest.yml, installer veya blockmap birbiriyle eşleşmiyor.');
  }

  const orderedFiles = [installer, blockmap, manifest];
  let accessToken = credentials.accessToken;
  async function uploadFile(file, token) {
    const timeoutMs = getUpdateUploadTimeoutMs(file.contents.length);
    try {
      await westronApi.request(`/api/v1/admin/updates/${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.westron.update' },
        body: file.contents,
        accessToken: token,
        timeoutMs,
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        const fileSizeMb = (file.contents.length / 1024 / 1024).toFixed(1);
        throw new Error(
          `${file.name} (${fileSizeMb} MB) yüklemesi zaman aşımına uğradı. `
          + 'Bağlantınızı kontrol edip aynı release klasörüyle yeniden deneyin.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  for (let index = 0; index < orderedFiles.length; index += 1) {
    const file = orderedFiles[index];
    publishUpdateStatus({
      status: 'publishing',
      percent: Math.round((index / orderedFiles.length) * 100),
      message: `Güncelleme dosyası yükleniyor (${index + 1}/${orderedFiles.length}): ${file.name}`,
    });
    try {
      await uploadFile(file, accessToken);
    } catch (error) {
      if (error.status !== 401) throw error;
      credentials = await refreshWestronAuth(credentials);
      accessToken = credentials.accessToken;
      await uploadFile(file, accessToken);
    }
    publishUpdateStatus({
      status: 'publishing',
      percent: Math.round(((index + 1) / orderedFiles.length) * 100),
      message: `Güncelleme dosyaları sunucuya yükleniyor (${index + 1}/${orderedFiles.length}).`,
    });
  }
  publishUpdateStatus({
    status: 'up-to-date',
    percent: 100,
    message: 'Güncelleme yayımlandı. Kullanıcılar güncellemeleri denetleyebilir.',
  });
  return { cancelled: false, message: 'Güncelleme dosyaları yayımlandı.' };
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
      version: DISPLAY_VERSION,
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
      version: DISPLAY_VERSION,
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
    if (contents === undefined) return { minecraftDir: getDefaultMinecraftDir(), offlineUsername: 'Player' };
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

async function refreshWestronAuth(credentials) {
  const renewed = await westronApi.refresh({ refreshToken: credentials.refreshToken });
  await saveWestronAuth(renewed);
  return renewed;
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
  let fabricInstalled = false;
  try {
    const versions = await fs.readdir(path.join(settings.minecraftDir, 'versions'));
    fabricInstalled = versions.some((name) => name.startsWith('fabric-loader-') && name.endsWith(`-${GAME_VERSION}`));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const mods = await listMods(settings.minecraftDir);
  const resourcePacksDir = getContentDirectory(settings.minecraftDir, 'resourcepack');
  const shaderPacksDir = getContentDirectory(settings.minecraftDir, 'shader');
  const resourcePacks = await listFiles(resourcePacksDir, ['.zip']);
  const shaderPacks = await listFiles(shaderPacksDir, ['.zip']);
  const resourcePackInstalls = await readInstallIndex(resourcePacksDir, '.zip');
  const shaderPackInstalls = await readInstallIndex(shaderPacksDir, '.zip');
  const modInstalls = await readInstallIndex(getModsDir(settings.minecraftDir), '.jar');
  return {
    ...settings,
    version: app.getVersion(),
    displayVersion: DISPLAY_VERSION,
    microsoftAuthConfigured: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      process.env.MINECRAFT_KIT_MSA_CLIENT_ID || 'bcfe67e2-a947-4621-a650-81db09205316'
    ),
    gameVersion: GAME_VERSION,
    fabricInstalled,
    javaAvailable: await findJava(settings.minecraftDir),
    mods,
    resourcePacks,
    shaderPacks,
    resourcePackProjects: Object.keys(resourcePackInstalls),
    shaderProjects: Object.keys(shaderPackInstalls),
    modrinthModProjects: Object.keys(modInstalls),
    menuModInstalled: mods.some((mod) => mod.name === 'westron-client-skin-1.0.jar'),
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
  const jarName = 'westron-client-skin-1.0.jar';
  const legacyJarNames = ['westron-client-skin-1.0.0.jar', 'westron-client-menu-1.0.0.jar', 'nocturne-menu-1.0.0.jar'];
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
    }
  } catch {
    console.error('Could not read Westron account identity for local skin mapping.');
  }
  await writeLocalSkinIdentityFile(minecraftDir, minecraftUsername, westronUsername);
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
      kit: new MinecraftKit(),
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

async function resolveFabricTarget(minecraftDir) {
  const { kit, Loaders, asMinecraftVersionId } = await getMinecraftKit();
  const target = await kit.targets.resolve({
    id: 'westron-client-fabric',
    directory: minecraftDir,
    minecraft: { version: asMinecraftVersionId(GAME_VERSION) },
    loader: { type: Loaders.FABRIC },
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

async function installFabric() {
  const state = await getState();
  const { kit, target } = await resolveFabricTarget(state.minecraftDir);
  const plan = await kit.install.plan(target);
  const { DownloadCategories } = await getMinecraftKit();
  await runMinecraftInstall(kit, plan, {
    actionCategories: new Set([
      DownloadCategories.FABRIC_LIBRARY,
      DownloadCategories.RUNTIME_FILE,
    ]),
  });
  await installBundledMenu(state.minecraftDir);
  return `Fabric ${GAME_VERSION} ve Westron Client kuruldu.`;
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
  if (!state.fabricInstalled) throw new Error(`Önce Minecraft ${GAME_VERSION} için Fabric’i kurun.`);

  const microsoftSession = mode === 'microsoft' ? await microsoftAuth.getLaunchSession() : null;
  const username = microsoftSession?.account.username ?? offlineUsername;
  const { kit, target } = await resolveFabricTarget(state.minecraftDir);
  const plan = await kit.install.plan(target);
  const { AuthModes, createInstallProgressTracker } = await getMinecraftKit();
  const tracker = createInstallProgressTracker(plan, { throttleMs: 200 });
  const unsubscribe = tracker.subscribe(sendInstallProgress);
  try {
    await runMinecraftInstall(kit, plan, { onEvent: tracker.onEvent });
  } finally {
    tracker.finish();
    unsubscribe();
  }
  await installBundledMenu(state.minecraftDir);
  await writeLocalSkinIdentity(state.minecraftDir, username);

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
  return `Minecraft ${username} adıyla başlatıldı.`;
}

const MODRINTH_TYPES = new Set(['mod', 'resourcepack', 'shader']);

function assertModrinthType(type) {
  if (!MODRINTH_TYPES.has(type)) throw new Error('Geçersiz Modrinth içerik türü.');
}

function modrinthHeaders() {
  return { 'User-Agent': `WestronClient/${DISPLAY_VERSION} (launcher)` };
}

async function searchModrinth(type, query) {
  assertModrinthType(type);
  const facets = type === 'mod'
    ? [['project_type:mod'], [`versions:${GAME_VERSION}`], ['categories:fabric']]
    : [[`project_type:${type}`], [`versions:${GAME_VERSION}`]];
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

async function getProjectVersions(projectId, type = 'mod') {
  assertModrinthType(type);
  const filters = { game_versions: JSON.stringify([GAME_VERSION]) };
  if (type === 'mod') filters.loaders = JSON.stringify(['fabric']);
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

async function getCompatibleVersion(projectId) {
  const versions = await getProjectVersions(projectId);
  return selectCompatibleVersion(versions, GAME_VERSION, 'fabric');
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

async function resolveModInstallPlan(projectId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Geçersiz Modrinth proje kimliği.');
  const state = await getState();
  if (!state.fabricInstalled) throw new Error('Önce Minecraft 26.3 için Fabric profilini kurun.');

  const projectTitles = new Map();
  async function titleFor(id) {
    if (!projectTitles.has(id)) projectTitles.set(id, getProjectTitle(id));
    return projectTitles.get(id);
  }
  const rootVersions = await getProjectVersions(projectId);
  const result = await selectInstallableVersion(
    rootVersions,
    GAME_VERSION,
    'fabric',
    async (rootVersion) => {
      const plan = [];
      const visited = new Set();
      async function resolveRequired(version, title, dependencyProjectId = version.project_id) {
        const versionKey = version.id || version.project_id;
        if (!versionKey || visited.has(versionKey)) return;
        visited.add(versionKey);
        if (!selectCompatibleVersion([version], GAME_VERSION, 'fabric')) {
          throw new ModCompatibilityError(`"${title}" için Minecraft ${GAME_VERSION} Fabric sürümü uyumlu değil.`);
        }
        for (const dependency of version.dependencies || []) {
          if (dependency.dependency_type !== 'required') continue;
          const dependencyVersion = await resolveDependencyVersion(dependency, {
            gameVersion: GAME_VERSION,
            loader: 'fabric',
            dependencyLabel: dependency.project_id || dependency.version_id,
            getVersionById,
            getCompatibleVersion,
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
  if (!result) throw new Error(`Minecraft ${GAME_VERSION} ve Fabric ile uyumlu mod sürümü bulunamadı.`);

  const modsDir = getModsDir(state.minecraftDir);
  await fs.mkdir(modsDir, { recursive: true });
  return { plan: result.plan, modsDir };
}

async function installMod(projectId, confirmedDependencyIds = null) {
  const { plan, modsDir } = await resolveModInstallPlan(projectId);
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

async function installModrinthPack(type, projectId) {
  if (type !== 'resourcepack' && type !== 'shader') {
    throw new Error('Kaynak paketi veya shader paketi türü seçilmelidir.');
  }
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error('Geçersiz Modrinth proje kimliği.');
  }
  const versions = await getProjectVersions(projectId, type);
  const version = selectCompatibleVersion(versions, GAME_VERSION);
  if (!version) {
    const label = type === 'resourcepack' ? 'kaynak paketi' : 'shader paketi';
    throw new Error(`Minecraft ${GAME_VERSION} ile uyumlu ${label} sürümü bulunamadı.`);
  }
  const file = version.files?.find((item) => item.primary && item.filename?.toLowerCase().endsWith('.zip'))
    || version.files?.find((item) => item.filename?.toLowerCase().endsWith('.zip'));
  if (!file) throw new Error('Bu Modrinth sürümünde indirilebilir ZIP dosyası bulunamadı.');
  const directory = getContentDirectory((await getState()).minecraftDir, type);
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
ipcMain.handle('app:install-fabric', installFabric);
ipcMain.handle('app:launch-game', (_event, options) => launchGame(options));
ipcMain.handle('app:install-menu', async () => {
  const state = await getState();
  if (!state.fabricInstalled) throw new Error('Önce Minecraft 26.3 için Fabric profilini kurun.');
  await installBundledMenu(state.minecraftDir);
  return 'Westron Client kuruldu.';
});
ipcMain.handle('app:search-mods', (_event, query) => searchModrinth('mod', String(query || '').slice(0, 100)));
ipcMain.handle('app:search-content', (_event, type, query) =>
  searchModrinth(String(type), String(query || '').slice(0, 100)));
ipcMain.handle('app:install-mod', (_event, projectId, confirmedDependencyIds) =>
  installMod(String(projectId), confirmedDependencyIds));
ipcMain.handle('app:install-content', (_event, type, projectId) =>
  installModrinthPack(String(type), String(projectId)));
ipcMain.handle('app:update-status', () => updateStatus);
ipcMain.handle('app:check-for-updates', checkForUpdates);
ipcMain.handle('app:publish-update', publishUpdateFiles);
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
  logout: westronLogout,
});
ipcMain.handle('app:remove-mod', async (_event, fileName) => {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.jar')) {
    throw new Error('Geçersiz mod dosyası.');
  }
  const state = await getState();
  await removeInstalledFile(getModsDir(state.minecraftDir), '.jar', fileName);
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
  await removeInstalledFile(getContentDirectory(state.minecraftDir, type), '.zip', fileName);
  return getState();
});
ipcMain.handle('app:open-mods-folder', async () => {
  const state = await getState();
  const modsDir = getModsDir(state.minecraftDir);
  await fs.mkdir(modsDir, { recursive: true });
  const error = await shell.openPath(modsDir);
  if (error) throw new Error(error);
});
ipcMain.handle('app:open-content-folder', async (_event, type) => {
  if (type !== 'resourcepack' && type !== 'shader') throw new Error('Geçersiz Modrinth içerik türü.');
  const state = await getState();
  const directory = getContentDirectory(state.minecraftDir, type);
  await fs.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
});
ipcMain.handle('app:copy-server', (_event, address) => {
  if (typeof address !== 'string' || address.length > 255 || !/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(address)) {
    throw new Error('Sunucu adresi geçerli bir alan adı/IP ve isteğe bağlı port olmalıdır.');
  }
  clipboard.writeText(address);
  return true;
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

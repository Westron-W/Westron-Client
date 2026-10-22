const { contextBridge, ipcRenderer } = require('electron');

const WESTRON_IPC_CHANNELS = Object.freeze({
  getAccount: 'app:westron-account',
  register: 'app:westron-register',
  login: 'app:westron-login',
  verifyEmail: 'app:westron-verify-email',
  resendVerification: 'app:westron-resend-verification',
  requestPasswordReset: 'app:westron-request-password-reset',
  resetPassword: 'app:westron-reset-password',
  profile: 'app:westron-profile',
  uploadSkin: 'app:westron-upload-skin',
  logout: 'app:westron-logout',
});

contextBridge.exposeInMainWorld('nocturne', {
  getState: () => ipcRenderer.invoke('app:state'),
  chooseMinecraftDir: () => ipcRenderer.invoke('app:choose-minecraft-dir'),
  installFabric: () => ipcRenderer.invoke('app:install-fabric'),
  launchGame: (options) => ipcRenderer.invoke('app:launch-game', options),
  getMicrosoftAccount: () => ipcRenderer.invoke('app:microsoft-account'),
  signInMicrosoft: () => ipcRenderer.invoke('app:microsoft-sign-in'),
  cancelMicrosoftSignIn: () => ipcRenderer.invoke('app:microsoft-cancel-sign-in'),
  signOutMicrosoft: () => ipcRenderer.invoke('app:microsoft-sign-out'),
  getWestronAccount: () => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.getAccount),
  registerWestronAccount: (input) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.register, input),
  loginWestronAccount: (input) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.login, input),
  verifyWestronEmail: (input) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.verifyEmail, input),
  resendWestronVerification: (input) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.resendVerification, input),
  requestWestronPasswordReset: (input) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.requestPasswordReset, input),
  resetWestronPassword: (input) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.resetPassword, input),
  getWestronProfile: () => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.profile),
  uploadWestronSkin: (model) => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.uploadSkin, model),
  logoutWestronAccount: () => ipcRenderer.invoke(WESTRON_IPC_CHANNELS.logout),
  onGameExit: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('app:game-exited', listener);
    return () => ipcRenderer.removeListener('app:game-exited', listener);
  },
  onInstallProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('app:install-progress', listener);
    return () => ipcRenderer.removeListener('app:install-progress', listener);
  },
  installMenu: () => ipcRenderer.invoke('app:install-menu'),
  searchMods: (query) => ipcRenderer.invoke('app:search-mods', query),
  searchContent: (type, query) => ipcRenderer.invoke('app:search-content', type, query),
  installMod: (projectId, confirmedDependencyIds) =>
    ipcRenderer.invoke('app:install-mod', projectId, confirmedDependencyIds),
  installContent: (type, projectId) => ipcRenderer.invoke('app:install-content', type, projectId),
  removeMod: (fileName) => ipcRenderer.invoke('app:remove-mod', fileName),
  removeContent: (type, fileName) => ipcRenderer.invoke('app:remove-content', type, fileName),
  getUpdateStatus: () => ipcRenderer.invoke('app:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  publishUpdate: () => ipcRenderer.invoke('app:publish-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
  openModsFolder: () => ipcRenderer.invoke('app:open-mods-folder'),
  openContentFolder: (type) => ipcRenderer.invoke('app:open-content-folder', type),
  copyServer: (address) => ipcRenderer.invoke('app:copy-server', address),
});

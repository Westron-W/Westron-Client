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
  deleteSkin: 'app:westron-delete-skin',
  uploadCape: 'app:westron-upload-cape',
  deleteCape: 'app:westron-delete-cape',
  logout: 'app:westron-logout',
  listFriends: 'app:westron-list-friends',
  sendFriendRequest: 'app:westron-send-friend-request',
  respondFriendRequest: 'app:westron-respond-friend-request',
  removeFriend: 'app:westron-remove-friend',
  updatePresence: 'app:westron-update-presence',
  sendEphemeralMessage: 'app:westron-send-ephemeral-message',
  listEphemeralMessages: 'app:westron-list-ephemeral-messages',
  consumeEphemeralMessage: 'app:westron-consume-ephemeral-message',
  getVoiceCallIceServers: 'app:westron-get-voice-call-ice-servers',
  sendVoiceCallSignal: 'app:westron-send-voice-call-signal',
  consumeVoiceCallSignals: 'app:westron-consume-voice-call-signals',
});

function invokeWestron(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((reason) => {
    const rawMessage = typeof reason?.message === 'string' ? reason.message : String(reason);
    const message = rawMessage
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error:\s*/, '');
    throw new Error(message || 'Westron isteği tamamlanamadı.');
  });
}

contextBridge.exposeInMainWorld('nocturne', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('app:state'),
  controlWindow: (action) => ipcRenderer.invoke('app:window-control', action),
  chooseMinecraftDir: () => ipcRenderer.invoke('app:choose-minecraft-dir'),
  getGameVersions: () => ipcRenderer.invoke('app:game-versions'),
  saveGameOptions: (gameVersion, loader, confirmNewProfile, dismissNotice) =>
    ipcRenderer.invoke('app:save-game-options', gameVersion, loader, confirmNewProfile, dismissNotice),
  chooseCustomProfileDirectory: () => ipcRenderer.invoke('app:choose-custom-profile-directory'),
  selectCustomProfile: (profileId) => ipcRenderer.invoke('app:select-custom-profile', profileId),
  createCustomProfile: (input) => ipcRenderer.invoke('app:create-custom-profile', input),
  updateCustomProfile: (profileId, input) =>
    ipcRenderer.invoke('app:update-custom-profile', profileId, input),
  deleteCustomProfile: (profileId, deleteFiles) =>
    ipcRenderer.invoke('app:delete-custom-profile', profileId, deleteFiles),
  setTitleBarTheme: (theme, performanceMode, performanceThemeEnabled) =>
    ipcRenderer.invoke('app:set-title-bar-theme', theme, performanceMode, performanceThemeEnabled),
  saveLanguage: (language) => ipcRenderer.invoke('app:save-language', language),
  saveTheme: (theme) => ipcRenderer.invoke('app:save-theme', theme),
  installGameProfile: () => ipcRenderer.invoke('app:install-game-profile'),
  installFabric: () => ipcRenderer.invoke('app:install-fabric'),
  launchGame: (options) => ipcRenderer.invoke('app:launch-game', options),
  getMicrosoftAccount: () => ipcRenderer.invoke('app:microsoft-account'),
  signInMicrosoft: () => ipcRenderer.invoke('app:microsoft-sign-in'),
  cancelMicrosoftSignIn: () => ipcRenderer.invoke('app:microsoft-cancel-sign-in'),
  signOutMicrosoft: () => ipcRenderer.invoke('app:microsoft-sign-out'),
  getWestronAccount: () => invokeWestron(WESTRON_IPC_CHANNELS.getAccount),
  registerWestronAccount: (input) => invokeWestron(WESTRON_IPC_CHANNELS.register, input),
  loginWestronAccount: (input) => invokeWestron(WESTRON_IPC_CHANNELS.login, input),
  verifyWestronEmail: (input) => invokeWestron(WESTRON_IPC_CHANNELS.verifyEmail, input),
  resendWestronVerification: (input) => invokeWestron(WESTRON_IPC_CHANNELS.resendVerification, input),
  requestPasswordReset: (input) => invokeWestron(WESTRON_IPC_CHANNELS.requestPasswordReset, input),
  resetPassword: (input) => invokeWestron(WESTRON_IPC_CHANNELS.resetPassword, input),
  getWestronProfile: () => invokeWestron(WESTRON_IPC_CHANNELS.profile),
  uploadWestronSkin: (model) => invokeWestron(WESTRON_IPC_CHANNELS.uploadSkin, model),
  deleteWestronSkin: () => invokeWestron(WESTRON_IPC_CHANNELS.deleteSkin),
  uploadWestronCape: () => invokeWestron(WESTRON_IPC_CHANNELS.uploadCape),
  deleteWestronCape: () => invokeWestron(WESTRON_IPC_CHANNELS.deleteCape),
  logoutWestronAccount: () => invokeWestron(WESTRON_IPC_CHANNELS.logout),
  listWestronFriends: () => invokeWestron(WESTRON_IPC_CHANNELS.listFriends),
  sendWestronFriendRequest: (input) => invokeWestron(WESTRON_IPC_CHANNELS.sendFriendRequest, input),
  respondWestronFriendRequest: (input) => invokeWestron(WESTRON_IPC_CHANNELS.respondFriendRequest, input),
  removeWestronFriend: (input) => invokeWestron(WESTRON_IPC_CHANNELS.removeFriend, input),
  updateWestronPresence: (input) => invokeWestron(WESTRON_IPC_CHANNELS.updatePresence, input),
  sendWestronEphemeralMessage: (input) => invokeWestron(WESTRON_IPC_CHANNELS.sendEphemeralMessage, input),
  listWestronEphemeralMessages: () => invokeWestron(WESTRON_IPC_CHANNELS.listEphemeralMessages),
  consumeWestronEphemeralMessage: (input) => invokeWestron(WESTRON_IPC_CHANNELS.consumeEphemeralMessage, input),
  getWestronVoiceCallIceServers: () => invokeWestron(WESTRON_IPC_CHANNELS.getVoiceCallIceServers),
  sendWestronVoiceCallSignal: (input) => invokeWestron(WESTRON_IPC_CHANNELS.sendVoiceCallSignal, input),
  consumeWestronVoiceCallSignals: () => invokeWestron(WESTRON_IPC_CHANNELS.consumeVoiceCallSignals),
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
  searchMods: (query, offset = 0) => ipcRenderer.invoke('app:search-mods', query, offset),
  searchContent: (type, query, offset = 0) => ipcRenderer.invoke('app:search-content', type, query, offset),
  getProjectVersions: (type, projectId) => ipcRenderer.invoke('app:project-versions', type, projectId),
  getProjectMetadata: (projectIds) => ipcRenderer.invoke('app:project-metadata', projectIds),
  getProjectIcons: (projectIds) => ipcRenderer.invoke('app:project-icons', projectIds),
  getModArchiveMetadata: (fileNames) => ipcRenderer.invoke('app:mod-archive-metadata', fileNames),
  installMod: (projectId, confirmedDependencyIds, forceReinstall = false) =>
    ipcRenderer.invoke('app:install-mod', projectId, null, confirmedDependencyIds, forceReinstall),
  installModVersion: (projectId, selectedVersionId, confirmedDependencyIds, forceReinstall = false) =>
    ipcRenderer.invoke('app:install-mod', projectId, selectedVersionId, confirmedDependencyIds, forceReinstall),
  installContent: (type, projectId, selectedVersionId, forceReinstall = false) =>
    ipcRenderer.invoke('app:install-content', type, projectId, selectedVersionId, forceReinstall),
  installPerformancePreset: (mode, includeShader) =>
    ipcRenderer.invoke('app:install-performance-preset', mode, includeShader),
  removeMod: (fileName) => ipcRenderer.invoke('app:remove-mod', fileName),
  removeContent: (type, fileName) => ipcRenderer.invoke('app:remove-content', type, fileName),
  getUpdateStatus: () => ipcRenderer.invoke('app:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
  openModsFolder: () => ipcRenderer.invoke('app:open-mods-folder'),
  openContentFolder: (type) => ipcRenderer.invoke('app:open-content-folder', type),
  openProfilesFolder: () => ipcRenderer.invoke('app:open-profiles-folder'),
  openSelectedProfileFolder: () => ipcRenderer.invoke('app:open-selected-profile-folder'),
  saveGameBehavior: (behavior) => ipcRenderer.invoke('app:save-game-behavior', behavior),
  publishUpdate: () => ipcRenderer.invoke('app:publish-update'),
  listScreenshots: () => ipcRenderer.invoke('app:list-screenshots'),
  listScreenshotsPage: (offset, limit) => ipcRenderer.invoke('app:list-screenshots-page', offset, limit),
  readScreenshot: (fileName) => ipcRenderer.invoke('app:read-screenshot', fileName),
  deleteScreenshot: (fileName) => ipcRenderer.invoke('app:delete-screenshot', fileName),
  openScreenshotsFolder: () => ipcRenderer.invoke('app:open-screenshots-folder'),
});

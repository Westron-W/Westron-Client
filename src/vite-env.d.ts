/// <reference types="vite/client" />

type AppLanguage = 'tr' | 'en' | 'de' | 'fr' | 'es' | 'ru' | 'it';
type AppTheme = 'dark' | 'light';
type GameBehavior = 'close-on-game-exit' | 'stay-open' | 'hide-and-restore';
type GameLoader = 'vanilla' | 'fabric' | 'forge';

interface CustomGameProfile {
  id: string;
  name: string;
  gameVersion: string;
  loader: GameLoader;
  memoryMb: number;
  directory: string;
}

interface CustomGameProfileInput {
  name: string;
  gameVersion: string;
  loader: GameLoader;
  memoryMb: number;
  directory?: string;
}

interface LauncherState {
  minecraftDir: string;
  platform: NodeJS.Platform;
  offlineUsername: string;
  version: string;
  displayVersion: string;
  microsoftAuthConfigured: boolean;
  gameVersion: string;
  loader: GameLoader;
  gameDirectory: string;
  customProfiles: CustomGameProfile[];
  selectedCustomProfileId: string | null;
  maxCustomMemoryMb: number;
  gameRunning: boolean;
  loaderInstalled: boolean;
  fabricInstalled: boolean;
  westronModSupported: boolean;
  language: AppLanguage;
  theme: AppTheme;
  gameBehavior: GameBehavior;
  languageSetupComplete: boolean;
  menuModInstalled: boolean;
  javaAvailable: string;
  mods: { name: string; size: number; projectId?: string }[];
  resourcePacks: { name: string; size: number; projectId?: string }[];
  shaderPacks: { name: string; size: number; projectId?: string }[];
  performanceMode: 'default' | 'performance' | 'quality';
  performanceShaderEnabled: boolean;
  modrinthModProjects: string[];
  resourcePackProjects: string[];
  shaderProjects: string[];
}

interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'unavailable';
  currentVersion: string;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

interface GameScreenshot {
  name: string;
  size: number;
  modifiedAt: string;
  preview: string;
}

interface GameScreenshotPage {
  items: GameScreenshot[];
  total: number;
}

interface MicrosoftAccount {
  username: string;
  uuid: string;
  skinUrl: string | null;
}

interface GameExit {
  username: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  aborted: boolean;
}

interface InstallProgress {
  stage: string;
  overallPercent: number;
  overallBytesDownloaded: number;
  overallTotalBytes: number;
  currentFile?: string;
}

interface ModDependency {
  projectId: string;
  title: string;
}

type ModInstallResult =
  | { status: 'confirmation-required'; dependencies: ModDependency[] }
  | {
      status: 'installed';
      files: string[];
      projectIds: string[];
      managedFiles: { projectId: string; fileName: string }[];
      cancelled: false;
      dependencies: string[];
    };

interface ModrinthPackInstallResult {
  status: 'installed' | 'already-installed';
  fileName: string;
  projectId: string;
  managedFile: { projectId: string; fileName: string } | null;
  versionNumber: string;
}

interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string;
  downloads: number;
  categories: string[];
}

interface ModArchiveMetadata {
  iconUrl: string;
  description: string;
}

interface ModrinthProjectMetadata {
  title: string;
  iconUrl: string;
  description: string;
}

interface ModrinthSearchPage {
  projects: ModrinthProject[];
  totalHits: number;
  offset: number;
}

interface ModrinthVersionOption {
  id: string;
  versionNumber: string;
  name: string;
  datePublished: string;
  gameVersions: string[];
  loaders: string[];
}

interface MinecraftVersionOption {
  id: string;
  kind: 'release' | 'snapshot';
}

interface WestronAccount {
  username: string;
  email: string;
  emailVerified: boolean;
}

interface WestronFriend {
  userId: string;
  username: string;
  minecraftUsername?: string | null;
  online: boolean;
  inGame: boolean;
  serverName?: string | null;
}

interface WestronFriendRequest {
  requestId: string;
  userId: string;
  username: string;
  createdAt: string;
}

interface WestronFriendList {
  friends: WestronFriend[];
  incomingRequests: WestronFriendRequest[];
  outgoingRequests: WestronFriendRequest[];
}

interface WestronFriendGroup {
  id: string;
  name: string;
  ownerUserId: string;
  createdByUserId: string;
  createdAt: string;
  members: { userId: string; username: string; minecraftUsername?: string | null }[];
}

interface WestronFriendGroupMessage {
  messageId: string;
  senderUserId: string;
  senderUsername: string;
  body: string;
  kind: 'text' | 'photo';
  createdAt: string;
}

interface WestronEphemeralMessage {
  messageId: string;
  senderUserId: string;
  senderUsername: string;
  createdAt: string;
  kind: 'text' | 'photo';
}

interface WestronConsumedEphemeralMessage {
  senderUserId: string;
  senderUsername: string;
  body: string;
  createdAt: string;
}

interface WestronConversationMessage {
  messageId: string;
  senderUserId: string;
  senderUsername: string;
  recipientUserId: string;
  body: string;
  kind: 'text' | 'photo';
  photoUrl?: string | null;
  photoViewedByMe?: boolean;
  createdAt: string;
}

interface WestronIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

type WestronCallSignalType = 'offer' | 'answer' | 'candidate' | 'hangup' | 'reject';

interface WestronCallSignal {
  signalId: string;
  fromUserId: string;
  fromUsername: string;
  groupId?: string | null;
  callId: string;
  type: WestronCallSignalType;
  sdp: string;
}

interface WestronProfile {
  username: string;
  skin: null | {
    model: 'classic' | 'slim';
    url: string;
    updatedAt: string;
  };
  cape: null | {
    url: string;
    updatedAt: string;
  };
  elytra: null | {
    url: string;
    updatedAt: string;
  };
}

interface Window {
  nocturne: {
    platform: NodeJS.Platform;
    getState: () => Promise<LauncherState>;
    controlWindow: (action: 'minimize' | 'maximize' | 'close') => Promise<void>;
    chooseMinecraftDir: () => Promise<LauncherState>;
    getGameVersions: () => Promise<MinecraftVersionOption[]>;
    saveGameOptions: (
      gameVersion: string,
      loader: GameLoader,
      confirmNewProfile?: boolean,
      dismissNotice?: boolean,
    ) => Promise<{ requiresConfirmation: true; profileDirectory: string } | { requiresConfirmation: false; state: LauncherState }>;
    chooseCustomProfileDirectory: () => Promise<string | null>;
    selectCustomProfile: (profileId: string | null) => Promise<LauncherState>;
    createCustomProfile: (input: CustomGameProfileInput) => Promise<LauncherState>;
    updateCustomProfile: (profileId: string, input: CustomGameProfileInput) => Promise<LauncherState>;
    deleteCustomProfile: (
      profileId: string,
      deleteFiles: boolean,
    ) => Promise<{ state: LauncherState; cleanupError: string | null }>;
    setTitleBarTheme: (
      theme: AppTheme,
      performanceMode: LauncherState['performanceMode'],
      performanceThemeEnabled: boolean,
    ) => Promise<void>;
    saveLanguage: (language: LauncherState['language']) => Promise<LauncherState>;
    saveTheme: (theme: AppTheme) => Promise<LauncherState>;
    installGameProfile: () => Promise<string>;
    installFabric: () => Promise<string>;
    launchGame: (options: { mode: 'offline' | 'microsoft'; offlineUsername?: string }) => Promise<string>;
    getMicrosoftAccount: () => Promise<MicrosoftAccount | null>;
    signInMicrosoft: () => Promise<MicrosoftAccount>;
    cancelMicrosoftSignIn: () => Promise<string>;
    signOutMicrosoft: () => Promise<string>;
    getWestronAccount: () => Promise<WestronAccount | null>;
    registerWestronAccount: (input: { username: string; email: string; password: string }) => Promise<string>;
    loginWestronAccount: (input: { email: string; password: string }) => Promise<WestronAccount>;
    verifyWestronEmail: (input: { email: string; token: string }) => Promise<string>;
    resendWestronVerification: (input: { email: string }) => Promise<string>;
    requestPasswordReset: (input: { email: string }) => Promise<string>;
    resetPassword: (input: { email: string; token: string; newPassword: string }) => Promise<string>;
    getWestronProfile: () => Promise<WestronProfile | null>;
    uploadWestronSkin: (model: 'classic' | 'slim') => Promise<{ cancelled: boolean; profile?: WestronProfile }>;
    deleteWestronSkin: () => Promise<WestronProfile | null>;
    uploadWestronCape: () => Promise<{ cancelled: boolean; profile?: WestronProfile }>;
    deleteWestronCape: () => Promise<WestronProfile | null>;
    uploadWestronElytra: () => Promise<{ cancelled: boolean; profile?: WestronProfile }>;
    deleteWestronElytra: () => Promise<WestronProfile | null>;
    logoutWestronAccount: () => Promise<string>;
    listWestronFriends: () => Promise<WestronFriendList>;
    getWestronFriendSkinUrl: (input: { username: string; minecraftUsername?: string | null }) => Promise<string | null>;
    searchWestronFriends: (input: { query: string }) => Promise<{ userId: string; username: string }[]>;
    listWestronGroups: () => Promise<WestronFriendGroup[]>;
    createWestronGroup: (input: { name: string; memberUserIds: string[] }) => Promise<{ groupId: string; name: string }>;
    renameWestronGroup: (input: { groupId: string; name: string }) => Promise<{ groupId: string; name: string }>;
    deleteWestronGroup: (input: { groupId: string }) => Promise<{ deleted: true }>;
    removeWestronGroupMember: (input: { groupId: string; memberUserId: string }) => Promise<{ removed: true; groupDeleted: boolean }>;
    listWestronGroupConversation: (input: { groupId: string }) => Promise<WestronFriendGroupMessage[]>;
    sendWestronGroupMessage: (input: { groupId: string; body: string }) => Promise<{ messageId: string; kind: 'text' }>;
    getWestronGroupMessagePhoto: (input: { groupId: string; messageId: string }) => Promise<string>;
    chooseAndSendWestronGroupPhoto: (input: { groupId: string }) => Promise<
      { cancelled: true } | { cancelled: false; messageId: string }
    >;
    sendWestronFriendRequest: (input: { username: string }) => Promise<{ message: string }>;
    respondWestronFriendRequest: (input: { requestId: string; accept: boolean }) => Promise<{ message: string }>;
    cancelWestronFriendRequest: (input: { requestId: string }) => Promise<{ cancelled: true }>;
    removeWestronFriend: (input: { userId: string }) => Promise<{ message: string }>;
    updateWestronPresence: (input: { inGame: boolean }) => Promise<{ updated: true }>;
    sendWestronEphemeralMessage: (input: { recipientUserId: string; body: string }) => Promise<{ messageId: string }>;
    listWestronEphemeralMessages: () => Promise<WestronEphemeralMessage[]>;
    consumeWestronEphemeralMessage: (input: { messageId: string }) => Promise<WestronConsumedEphemeralMessage>;
    listWestronConversation: (input: { friendUserId: string }) => Promise<WestronConversationMessage[]>;
    getWestronMessagePhoto: (input: { messageId: string }) => Promise<string>;
    recallWestronMessage: (input: { messageId: string; groupId?: string }) => Promise<{ recalled: true }>;
    chooseAndSendWestronPhoto: (input: { recipientUserId: string }) => Promise<
      { cancelled: true } | { cancelled: false; messageId: string }
    >;
    updateWestronVoiceOverlay: (input: {
      enabled: boolean;
      participants: string[];
      speaking: string[];
      call?: {
        incoming: boolean;
        self: string;
        selfSkinUrl?: string;
        selfSpeaking: boolean;
        friend: string;
        status: string;
        avatarShape?: 'round' | 'square';
        microphoneMuted: boolean;
        remoteAudioMuted: boolean;
        friendMicrophoneMuted?: boolean;
        friendSpeakerMuted?: boolean;
        canAddParticipant?: boolean;
        friendSkinUrl?: string;
        groupParticipants?: {
          username: string;
          skinUrl: string;
          connected: boolean;
          speaking: boolean;
          microphoneMuted?: boolean;
          speakerMuted?: boolean;
        }[];
        labels: Record<string, string>;
      };
    }) => Promise<void>;
    showWestronVoiceCallWindow: () => Promise<void>;
    onVoiceCallAction: (callback: (
      action: 'accept' | 'reject' | 'end' | 'toggle-microphone' | 'toggle-speaker' | 'add-participant',
    ) => void) => () => void;
    onVoiceCallWindowState: (callback: (state: {
      open: boolean;
      visible: boolean;
      minimized: boolean;
      opening: boolean;
    }) => void) => () => void;
    playWestronNotification: (kind: 'call' | 'message') => Promise<void>;
    showWestronNotification: (input: { sender: string; message: string; notificationId?: string }) => Promise<{ shown: boolean }>;
    onOpenFriends: (callback: (notificationId?: string) => void) => () => void;
    getMinecraftSkinUrl: (input: { username: string }) => Promise<string | null>;
    getWestronVoiceCallIceServers: () => Promise<{ iceServers: WestronIceServer[] }>;
    sendWestronVoiceCallSignal: (input: {
      recipientUserId: string;
      groupId?: string;
      callId: string;
      type: WestronCallSignalType;
      sdp: string;
    }) => Promise<{ sent: true }>;
    consumeWestronVoiceCallSignals: () => Promise<WestronCallSignal[]>;
    onGameExit: (callback: (result: GameExit) => void) => () => void;
    onInstallProgress: (callback: (progress: InstallProgress) => void) => () => void;
    installMenu: () => Promise<string>;
    searchMods: (query: string, offset?: number) => Promise<ModrinthSearchPage>;
    searchContent: (type: 'resourcepack' | 'shader', query: string, offset?: number) => Promise<ModrinthSearchPage>;
    getProjectVersions: (type: 'mod' | 'resourcepack' | 'shader', projectId: string) => Promise<ModrinthVersionOption[]>;
    getProjectMetadata: (projectIds: string[]) => Promise<Record<string, ModrinthProjectMetadata>>;
    getProjectIcons: (projectIds: string[]) => Promise<Record<string, string>>;
    getModArchiveMetadata: (fileNames: string[]) => Promise<Record<string, ModArchiveMetadata>>;
    installMod: (projectId: string, confirmedDependencyIds?: string[], forceReinstall?: boolean) => Promise<ModInstallResult>;
    installModVersion: (
      projectId: string,
      selectedVersionId: string,
      confirmedDependencyIds?: string[],
      forceReinstall?: boolean,
    ) => Promise<ModInstallResult>;
    installContent: (
      type: 'resourcepack' | 'shader',
      projectId: string,
      selectedVersionId?: string,
      forceReinstall?: boolean,
    ) => Promise<ModrinthPackInstallResult>;
    installPerformancePreset: (
      mode: 'default' | 'performance' | 'quality',
      includeShader: boolean,
    ) => Promise<{ installed: string[]; skipped: string[]; blocked?: 'game-running' }>;
    removeMod: (fileName: string) => Promise<LauncherState>;
    removeContent: (type: 'resourcepack' | 'shader', fileName: string) => Promise<LauncherState>;
    getUpdateStatus: () => Promise<UpdateStatus>;
    checkForUpdates: () => Promise<UpdateStatus>;
    downloadUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    openModsFolder: () => Promise<void>;
    openContentFolder: (type: 'resourcepack' | 'shader') => Promise<void>;
    openProfilesFolder: () => Promise<void>;
    openSelectedProfileFolder: () => Promise<void>;
    saveGameBehavior: (behavior: GameBehavior) => Promise<LauncherState>;
    publishUpdate: () => Promise<{ cancelled: boolean; version?: string }>;
    listScreenshots: () => Promise<GameScreenshotPage>;
    listScreenshotsPage: (offset: number, limit: number) => Promise<GameScreenshotPage>;
    readScreenshot: (fileName: string) => Promise<string>;
    deleteScreenshot: (fileName: string) => Promise<void>;
    downloadScreenshot: (fileName: string) => Promise<{ cancelled: boolean; path?: string }>;
    shareScreenshotToFriends: (input: { fileName: string; recipientUserIds: string[] }) => Promise<{ sent: true }>;
    shareScreenshotToGroups: (input: { fileName: string; groupIds: string[] }) => Promise<{ sent: true }>;
    openScreenshotsFolder: () => Promise<void>;
  };
}

/// <reference types="vite/client" />

type AppLanguage = 'tr' | 'en' | 'de' | 'fr' | 'es' | 'ru' | 'it';
type AppTheme = 'dark' | 'light';

interface LauncherState {
  minecraftDir: string;
  offlineUsername: string;
  version: string;
  displayVersion: string;
  microsoftAuthConfigured: boolean;
  gameVersion: string;
  loader: 'vanilla' | 'fabric' | 'forge';
  gameDirectory: string;
  loaderInstalled: boolean;
  fabricInstalled: boolean;
  westronModSupported: boolean;
  language: AppLanguage;
  theme: AppTheme;
  languageSetupComplete: boolean;
  menuModInstalled: boolean;
  javaAvailable: string;
  mods: { name: string; size: number }[];
  resourcePacks: { name: string; size: number }[];
  shaderPacks: { name: string; size: number }[];
  modrinthModProjects: string[];
  resourcePackProjects: string[];
  shaderProjects: string[];
}

interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'publishing' | 'error' | 'unavailable';
  currentVersion: string;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
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
  | { status: 'installed'; files: string[]; cancelled: false; dependencies: string[] };

interface ModrinthPackInstallResult {
  status: 'installed' | 'already-installed';
  fileName: string;
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
}

interface Window {
  nocturne: {
    getState: () => Promise<LauncherState>;
    chooseMinecraftDir: () => Promise<LauncherState>;
    getGameVersions: () => Promise<MinecraftVersionOption[]>;
    saveGameOptions: (
      gameVersion: string,
      loader: LauncherState['loader'],
      confirmNewProfile?: boolean,
      dismissNotice?: boolean,
    ) => Promise<{ requiresConfirmation: true; profileDirectory: string } | { requiresConfirmation: false; state: LauncherState }>;
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
    requestWestronPasswordReset: (input: { email: string }) => Promise<string>;
    resetWestronPassword: (input: { email: string; token: string; newPassword: string }) => Promise<string>;
    getWestronProfile: () => Promise<WestronProfile | null>;
    uploadWestronSkin: (model: 'classic' | 'slim') => Promise<{ cancelled: boolean; profile?: WestronProfile }>;
    deleteWestronSkin: () => Promise<WestronProfile | null>;
    uploadWestronCape: () => Promise<{ cancelled: boolean; profile?: WestronProfile }>;
    deleteWestronCape: () => Promise<WestronProfile | null>;
    logoutWestronAccount: () => Promise<string>;
    onGameExit: (callback: (result: GameExit) => void) => () => void;
    onInstallProgress: (callback: (progress: InstallProgress) => void) => () => void;
    installMenu: () => Promise<string>;
    searchMods: (query: string) => Promise<ModrinthProject[]>;
    searchContent: (type: 'resourcepack' | 'shader', query: string) => Promise<ModrinthProject[]>;
    getProjectVersions: (type: 'mod' | 'resourcepack' | 'shader', projectId: string) => Promise<ModrinthVersionOption[]>;
    installMod: (projectId: string, confirmedDependencyIds?: string[]) => Promise<ModInstallResult>;
    installModVersion: (projectId: string, selectedVersionId: string, confirmedDependencyIds?: string[]) => Promise<ModInstallResult>;
    installContent: (type: 'resourcepack' | 'shader', projectId: string, selectedVersionId?: string) => Promise<ModrinthPackInstallResult>;
    removeMod: (fileName: string) => Promise<LauncherState>;
    removeContent: (type: 'resourcepack' | 'shader', fileName: string) => Promise<LauncherState>;
    getUpdateStatus: () => Promise<UpdateStatus>;
    checkForUpdates: () => Promise<UpdateStatus>;
    downloadUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
    publishUpdate: () => Promise<{ cancelled: boolean; message?: string }>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    openModsFolder: () => Promise<void>;
    openContentFolder: (type: 'resourcepack' | 'shader') => Promise<void>;
  };
}

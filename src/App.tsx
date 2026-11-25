import { createContext, useContext, useEffect, useRef, useState, type ComponentType, type ReactNode, type SyntheticEvent } from 'react';
import { isAppLanguage, SUPPORTED_LANGUAGES, translate, translateUi, type AppLanguage } from './i18n';
import { FriendSkinFace } from './FriendSkinFace';
import type { FriendsNotification, FriendsPageProps } from './FriendsPage';
import launcherIcon from '../build/app-icon.svg';
import {
  ArrowDownToLine, ArrowRight, Box, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Compass, Download, Image, Share2,
  Cpu, FolderOpen, HardDrive, Layers3, LoaderCircle, Minus,
  Languages, LogOut, Mic, Package, Pause, Phone, PhoneOff, Play, Plus, RefreshCw, RotateCcw, Search, Square,
  Settings2, ShieldCheck, Shirt, Sparkles, Sun, Trash2, Upload, UserRound, Users, X,
} from 'lucide-react';

type ContentType = 'resourcepack' | 'shader';
type Page = 'home' | 'mods' | 'resourcepacks' | 'shaders' | 'performance' | 'library' | 'appearance' | 'account' | 'friends' | 'screenshots' | 'settings';
type LibrarySection = 'mods' | 'resourcepacks' | 'shaders';
const IRIS_PROJECT_ID = 'YL57xq9U';
const AppLanguageContext = createContext<AppLanguage>('en');

function playWelcomeIntroSound() {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (reason) {
    console.warn('Welcome sound could not be initialized.', reason);
    return;
  }
  void context.resume().then(() => {
    const notes = [523.25, 659.25, 783.99];
    const startedAt = context.currentTime;
    notes.forEach((frequency, index) => {
      const startAt = startedAt + index * 0.18;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.17);
    });
    window.setTimeout(() => {
      void context.close().catch((reason: unknown) => console.warn('Welcome sound could not be closed.', reason));
    }, 800);
  }).catch((reason: unknown) => {
    console.warn('Welcome sound could not be played.', reason);
    if (context.state !== 'closed') {
      void context.close().catch((closeReason: unknown) => console.warn('Welcome sound could not be closed.', closeReason));
    }
  });
}

function useUiText() {
  const language = useContext(AppLanguageContext);
  return (text: string) => translateUi(language, text);
}

const pageLabels: Record<Page, string> = {
  home: 'Genel Bakış',
  mods: 'Mod keşfet',
  resourcepacks: 'Kaynak paketleri',
  shaders: 'Shader paketleri',
  performance: 'Westron Launcher Modu',
  library: 'Kütüphane',
  appearance: 'Skin & Pelerin',
  account: 'Hesap',
  friends: 'Arkadaşlar',
  screenshots: 'Ekran Görüntüleri',
  settings: 'Ayarlar',
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const languageLocales: Record<AppLanguage, string> = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  ru: 'ru-RU',
  it: 'it-IT',
};

function formatDownloads(value: number, language: AppLanguage) {
  return new Intl.NumberFormat(languageLocales[language], { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [state, setState] = useState<LauncherState | null>(null);
  const [languageSetupRequired, setLanguageSetupRequired] = useState(false);
  const [setupLanguage, setSetupLanguage] = useState<AppLanguage>('en');
  const [welcomeIntroVisible, setWelcomeIntroVisible] = useState(false);
  const [mainWindowHighlighted, setMainWindowHighlighted] = useState(false);
  const [offlineUsername, setOfflineUsername] = useState('Player');
  const [mods, setMods] = useState<ModrinthProject[]>([]);
  const [modsTotal, setModsTotal] = useState(0);
  const [packProjects, setPackProjects] = useState<ModrinthProject[]>([]);
  const [packProjectsTotal, setPackProjectsTotal] = useState(0);
  const [gameVersions, setGameVersions] = useState<MinecraftVersionOption[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [friendNotifications, setFriendNotifications] = useState<FriendsNotification[]>([]);
  const friendNotificationTimersRef = useRef(new Map<string, number>());
  const [error, setError] = useState('');
  const [profilePrompt, setProfilePrompt] = useState<{
    gameVersion: string;
    loader: LauncherState['loader'];
    profileDirectory: string;
  } | null>(null);
  const [dismissProfileNotice, setDismissProfileNotice] = useState(false);
  const [dependencyPrompt, setDependencyPrompt] = useState<{
    projectId: string;
    modName: string;
    selectedVersionId: string;
    dependencies: ModDependency[];
  } | null>(null);
  const [versionPrompt, setVersionPrompt] = useState<{
    type: 'mod' | ContentType;
    projectId: string;
    title: string;
    versions: ModrinthVersionOption[];
    selectedVersionId: string;
  } | null>(null);
  const [removalPrompt, setRemovalPrompt] = useState<{
    name: string; size: number; type: 'mod' | ContentType;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [screenshots, setScreenshots] = useState<GameScreenshot[]>([]);
  const [screenshotStatus, setScreenshotStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const screenshotLoadGenerationRef = useRef(0);
  const [FriendsPageComponent, setFriendsPageComponent] = useState<ComponentType<FriendsPageProps> | null>(null);
  const [publisherBusy, setPublisherBusy] = useState(false);
  const [librarySection, setLibrarySection] = useState<LibrarySection>('mods');
  const [libraryQueries, setLibraryQueries] = useState<Record<LibrarySection, string>>({
    mods: '',
    resourcepacks: '',
    shaders: '',
  });
  const [libraryProjectMetadata, setLibraryProjectMetadata] = useState<Record<string, ModrinthProjectMetadata>>({});
  const [libraryModMetadata, setLibraryModMetadata] = useState<Record<string, ModArchiveMetadata>>({});
  const [microsoftAccount, setMicrosoftAccount] = useState<MicrosoftAccount | null>(null);
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [westronAccount, setWestronAccount] = useState<WestronAccount | null>(null);
  const [westronProfile, setWestronProfile] = useState<WestronProfile | null>(null);
  const [skinAvatarFailed, setSkinAvatarFailed] = useState(false);
  const [profileAvatarShape, setProfileAvatarShape] = useState<'round' | 'square'>(() => {
    const savedShape = localStorage.getItem('westron-profile-avatar-shape')
      ?? localStorage.getItem('westron-call-avatar-shape');
    return savedShape === 'square' ? 'square' : 'round';
  });
  const [performanceThemeEnabled, setPerformanceThemeEnabled] = useState(true);
  const [performanceThemeChoice, setPerformanceThemeChoice] = useState<'default' | 'performance' | 'quality' | 'blue'>(() => {
    const choice = localStorage.getItem('westron-performance-theme');
    return choice === 'performance' || choice === 'quality' || choice === 'blue' ? choice : 'default';
  });
  const [qualityShaderEnabled, setQualityShaderEnabled] = useState(false);
  const [customProfileManagerOpen, setCustomProfileManagerOpen] = useState(false);
  const mainWindowHighlightTimerRef = useRef<number | null>(null);
  const text = (value: string) => translateUi(state?.language ?? 'en', value);

  function pushFriendNotification(notification: FriendsNotification) {
    if (notification.kind !== 'call' && !friendNotificationTimersRef.current.has(notification.id)) {
      const timer = window.setTimeout(() => dismissFriendNotification(notification.id), 5000);
      friendNotificationTimersRef.current.set(notification.id, timer);
    }
    setFriendNotifications((current) => {
      const existing = current.some((item) => item.id === notification.id);
      if (existing) {
        return notification.kind === 'call'
          ? current.map((item) => item.id === notification.id ? notification : item)
          : current;
      }
      return [...current.slice(-3), notification];
    });
  }

  function dismissFriendNotification(id: string) {
    const timer = friendNotificationTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      friendNotificationTimersRef.current.delete(id);
    }
    setFriendNotifications((current) => current.filter((item) => item.id !== id));
  }
  const installPercent = Math.max(0, Math.min(100, Math.round(installProgress?.overallPercent ?? 0)));
  const pageTitle = text(pageLabels[page]);

  useEffect(() => {
    document.documentElement.lang = state?.language ?? 'en';
  }, [state?.language]);

  useEffect(() => {
    const removeNotificationListener = window.nocturne.onOpenFriends((notificationId) => {
      setPage('friends');
      if (notificationId) dismissFriendNotification(notificationId);
    });
    return () => {
      removeNotificationListener();
      for (const timer of friendNotificationTimersRef.current.values()) window.clearTimeout(timer);
      friendNotificationTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? 'dark';
  }, [state?.theme]);

  useEffect(() => {
    document.documentElement.dataset.profileAvatarShape = profileAvatarShape;
  }, [profileAvatarShape]);

  useEffect(() => {
    document.documentElement.dataset.performanceMode = state?.performanceMode ?? 'default';
    document.documentElement.dataset.performanceTheme = String(performanceThemeEnabled);
    document.documentElement.dataset.performanceThemeChoice = performanceThemeChoice;
  }, [state?.performanceMode, performanceThemeEnabled, performanceThemeChoice]);

  useEffect(() => {
    if (updateStatus?.status !== 'up-to-date') return undefined;
    const timeout = window.setTimeout(() => {
      setUpdateStatus((status) => status?.status === 'up-to-date' ? null : status);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [updateStatus?.status]);

  useEffect(() => {
    if (!state || !window.nocturne) return;
    void window.nocturne.setTitleBarTheme(
      state.theme,
      performanceThemeChoice === 'default' || performanceThemeChoice === 'blue'
        ? state.performanceMode
        : performanceThemeChoice,
      performanceThemeEnabled,
    ).catch(reportError);
  }, [state?.theme, state?.performanceMode, performanceThemeEnabled, performanceThemeChoice]);

  useEffect(() => {
    const message = error || notice;
    if (!message) return undefined;
    const isPersistentUpdate =
      notice === '' && updateStatus && ['available', 'downloading', 'downloaded', 'error', 'checking'].includes(updateStatus.status);
    const timeout = window.setTimeout(() => {
      if (error) setError('');
      else setNotice('');
    }, isPersistentUpdate ? 60_000 : (updateStatus?.status === 'up-to-date' ? 5000 : (message.trim().length > 100 ? 8000 : 5000)));
    return () => window.clearTimeout(timeout);
  }, [notice, error, updateStatus]);

  useEffect(() => {
    setQualityShaderEnabled(state?.performanceShaderEnabled ?? false);
  }, [state?.gameDirectory, state?.performanceShaderEnabled]);

  useEffect(() => {
    let active = true;
    if (!window.nocturne) return () => { active = false; };
    void window.nocturne.getWestronAccount().then(async (account) => {
      if (!active) return;
      setWestronAccount(account);
      if (account) {
        const profile = await window.nocturne.getWestronProfile();
        if (active) setWestronProfile(profile);
      }
    }).catch((reason: unknown) => {
      if (active) reportError(reason);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSkinAvatarFailed(false);
  }, [westronProfile?.skin?.url, westronProfile?.skin?.updatedAt]);

  async function refresh() {
    setState(await window.nocturne.getState());
  }

  async function refreshScreenshots() {
    const generation = ++screenshotLoadGenerationRef.current;
    if (!window.nocturne) {
      setScreenshotStatus('error');
      return;
    }
    setError('');
    setScreenshotStatus('loading');
    try {
      const result = await window.nocturne.listScreenshots();
      if (generation !== screenshotLoadGenerationRef.current) return;
      setScreenshots(result.items);
      if (generation === screenshotLoadGenerationRef.current) setScreenshotStatus('ready');
    } catch (reason) {
      if (generation === screenshotLoadGenerationRef.current) {
        setScreenshotStatus('error');
        reportError(reason);
      }
    }
  }

  useEffect(() => {
    if (!window.nocturne) {
      reportError(new Error('Launcher bağlantısı yüklenemedi. Uygulamayı yeniden başlatın.'));
      return;
    }
    void Promise.resolve().then(() => window.nocturne.getState()).then((nextState) => {
      setState(nextState);
      setOfflineUsername(nextState.offlineUsername);
      setSetupLanguage(nextState.language);
      setLanguageSetupRequired(!nextState.languageSetupComplete);
      setWelcomeIntroVisible(
        nextState.languageSetupComplete
          && localStorage.getItem('westron-launcher-intro-pending') === 'true',
      );
    }).catch(reportError);
    void window.nocturne.getGameVersions().then(setGameVersions).catch(reportError);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void import('./FriendsPage').then(({ default: LoadedFriendsPage }) => {
        if (active) setFriendsPageComponent(() => LoadedFriendsPage);
      }).catch((reason: unknown) => {
        if (active) reportError(reason);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!window.nocturne) return undefined;
    const unsubscribe = window.nocturne.onMainWindowHighlight(() => {
      setMainWindowHighlighted(false);
      if (mainWindowHighlightTimerRef.current !== null) {
        window.clearTimeout(mainWindowHighlightTimerRef.current);
      }
      window.requestAnimationFrame(() => setMainWindowHighlighted(true));
      mainWindowHighlightTimerRef.current = window.setTimeout(() => {
        setMainWindowHighlighted(false);
        mainWindowHighlightTimerRef.current = null;
      }, 1100);
    });
    return () => {
      unsubscribe();
      if (mainWindowHighlightTimerRef.current !== null) {
        window.clearTimeout(mainWindowHighlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!window.nocturne) return undefined;
    return window.nocturne.onGameExit((result) => {
      setBusy('');
      setInstallProgress(null);
      if (result.code !== 0 && !result.aborted) {
        setError(`Minecraft ${result.username} oturumu hata koduyla kapandı: ${result.code ?? result.signal}.`);
      } else {
        setNotice(`Minecraft ${result.username} oturumu kapandı.`);
      }
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshScreenshots(); }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (page === 'screenshots' && screenshotStatus !== 'loading') void refreshScreenshots();
  }, [page, state?.gameDirectory]);

  useEffect(() => {
    if (!window.nocturne) return undefined;
    return window.nocturne.onInstallProgress(setInstallProgress);
  }, []);

  useEffect(() => {
    if (!window.nocturne) return undefined;
    const unsubscribe = window.nocturne.onUpdateStatus(setUpdateStatus);
    void window.nocturne.getUpdateStatus().then(setUpdateStatus).catch(reportError);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!window.nocturne) return;
    void window.nocturne.getMicrosoftAccount().then(setMicrosoftAccount).catch(reportError);
  }, []);

  function reportError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes('404') || message.includes('API uç noktası') || message.includes('Error:')) {
      setError('');
      setNotice('');
      return;
    }
    setError(text(message));
  }

  async function perform<T>(label: string, action: () => Promise<T>, success?: (result: T) => string) {
    setBusy(label);
    setInstallProgress(null);
    setError('');
    setNotice('');
    try {
      const result = await action();
      await refresh();
      setNotice(success ? success(result) : 'İşlem tamamlandı.');
      return result;
    } catch (reason) {
      reportError(reason);
      return undefined;
    } finally {
      setBusy('');
      setInstallProgress(null);
    }
  }

  async function applyPerformanceMode(mode: LauncherState['performanceMode'], includeShader = false) {
    await perform(`performance:${mode}`, () => window.nocturne.installPerformancePreset(mode, includeShader), (result) => {
      if (result.blocked === 'game-running') return text('Oyun çalışırken performans modu değiştirilemez.');
      if (mode === 'default') return text('Varsayılan mod etkinleştirildi.');
      const message = text(mode === 'performance'
        ? 'Ultra Performans modu etkinleştirildi.'
        : 'Ultra Kalite modu etkinleştirildi.');
      return result.skipped.length
        ? `${message} ${text('Uyumlu olmayan modlar atlandı:')} ${result.skipped.join(', ')}`
        : message;
    });
  }

  async function search() {
    setBusy('search');
    setError('');
    try {
      const result = await window.nocturne.searchMods(query.trim());
      setMods(result.projects);
      setModsTotal(result.totalHits);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
    }
  }

  async function loadMoreMods() {
    if (busy || mods.length >= modsTotal) return;
    setBusy('search-more');
    setError('');
    try {
      const result = await window.nocturne.searchMods(query.trim(), mods.length);
      setMods((items) => [...items, ...result.projects]);
      setModsTotal(result.totalHits);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
    }
  }

  async function searchPacks(type: ContentType, searchQuery = query.trim()) {
    setBusy(`search:${type}`);
    setError('');
    try {
      const result = await window.nocturne.searchContent(type, searchQuery);
      setPackProjects(result.projects);
      setPackProjectsTotal(result.totalHits);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
    }
  }

  async function loadMorePacks(type: ContentType) {
    if (busy || packProjects.length >= packProjectsTotal) return;
    setBusy(`search:${type}:more`);
    setError('');
    try {
      const result = await window.nocturne.searchContent(type, query.trim(), packProjects.length);
      setPackProjects((items) => [...items, ...result.projects]);
      setPackProjectsTotal(result.totalHits);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
    }
  }

  async function requestVersionSelection(type: 'mod' | ContentType, projectId: string, title: string) {
    setBusy(`versions:${projectId}`);
    setError('');
    setNotice('');
    try {
      const versions = await window.nocturne.getProjectVersions(type, projectId);
      if (!versions.length) {
        throw new Error(`Minecraft ${state?.gameVersion ?? ''} sürümüyle uyumlu yayın bulunamadı.`);
      }
      const sortedVersions = [...versions].sort((a, b) =>
        Date.parse(b.datePublished) - Date.parse(a.datePublished));
      setVersionPrompt({
        type,
        projectId,
        title,
        versions: sortedVersions,
        selectedVersionId: sortedVersions[0].id,
      });
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
    }
  }

  function installSelectedVersion() {
    if (!versionPrompt) return;
    const { type, projectId, title, selectedVersionId } = versionPrompt;
    setVersionPrompt(null);
    if (type === 'mod') {
      void installMod(projectId, title, selectedVersionId);
    } else {
      void installPack(type, projectId, title, selectedVersionId);
    }
  }

  async function saveGameOptions(gameVersion: string, loader: LauncherState['loader'], confirm = false): Promise<boolean> {
    setBusy('profile-options');
    setError('');
    setNotice('');
    try {
      const result = await window.nocturne.saveGameOptions(
        gameVersion,
        loader,
        confirm,
        dismissProfileNotice,
      );
      if (result.requiresConfirmation) {
        setProfilePrompt({ gameVersion, loader, profileDirectory: result.profileDirectory });
        return false;
      }
      setState(result.state);
      setProfilePrompt(null);
      clearProfileSearchResults();
      setNotice(`Minecraft ${gameVersion} ${loader} profili seçildi.`);
      return true;
    } catch (reason) {
      reportError(reason);
      return false;
    } finally {
      setBusy('');
    }
  }

  function clearProfileSearchResults() {
    setMods([]);
    setModsTotal(0);
    setPackProjects([]);
    setPackProjectsTotal(0);
    setQuery('');
  }

  async function selectCustomProfile(profileId: string): Promise<LauncherState | null> {
    setBusy('custom-profile-select');
    setError('');
    setNotice('');
    try {
      const nextState = await window.nocturne.selectCustomProfile(profileId);
      setState(nextState);
      clearProfileSearchResults();
      setNotice(text('Özel profil seçildi.'));
      return nextState;
    } catch (reason) {
      reportError(reason);
      return null;
    } finally {
      setBusy('');
    }
  }

  async function saveCustomProfile(
    input: CustomGameProfileInput,
    profileId?: string,
  ): Promise<LauncherState | null> {
    setBusy('custom-profile-save');
    setError('');
    setNotice('');
    try {
      const nextState = profileId
        ? await window.nocturne.updateCustomProfile(profileId, input)
        : await window.nocturne.createCustomProfile(input);
      setState(nextState);
      clearProfileSearchResults();
      setNotice(text(profileId ? 'Özel profil güncellendi.' : 'Özel profil oluşturuldu.'));
      return nextState;
    } catch (reason) {
      reportError(reason);
      return null;
    } finally {
      setBusy('');
    }
  }

  async function deleteCustomProfile(
    profileId: string,
    deleteFiles: boolean,
  ): Promise<{ state: LauncherState; cleanupError: string | null } | null> {
    setBusy('custom-profile-delete');
    setError('');
    setNotice('');
    try {
      const result = await window.nocturne.deleteCustomProfile(profileId, deleteFiles);
      setState(result.state);
      clearProfileSearchResults();
      if (result.cleanupError) {
        setError(`${text('Profil silindi ancak oyun dosyaları tamamen kaldırılamadı.')} ${result.cleanupError}`);
      } else {
        setNotice(text('Özel profil silindi.'));
      }
      return result;
    } catch (reason) {
      reportError(reason);
      return null;
    } finally {
      setBusy('');
    }
  }

  async function chooseCustomProfileDirectory(): Promise<string | null> {
    try {
      return await window.nocturne.chooseCustomProfileDirectory();
    } catch (reason) {
      reportError(reason);
      return null;
    }
  }

  async function ensureFabricProfile() {
    if (!state) return;
    if (state.loader !== 'fabric') {
      if (await saveGameOptions(state.gameVersion, 'fabric')) setPage('home');
      return;
    }
    await perform('profile', () => window.nocturne.installGameProfile(), (message) => message || 'Fabric profili hazır.');
  }

  async function saveLanguage(language: AppLanguage): Promise<boolean> {
    const isInitialLanguageSetup = languageSetupRequired;
    setBusy('language');
    setError('');
    try {
      if (isInitialLanguageSetup) playWelcomeIntroSound();
      setState(await window.nocturne.saveLanguage(language));
      setNotice(`${translate(language, 'language')}: ${SUPPORTED_LANGUAGES.find((item) => item.code === language)?.label ?? language}`);
      setLanguageSetupRequired(false);
      if (isInitialLanguageSetup) {
        localStorage.setItem('westron-launcher-intro-pending', 'true');
        setWelcomeIntroVisible(true);
      }
      return true;
    } catch (reason) {
      reportError(reason);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function saveTheme(theme: AppTheme): Promise<boolean> {
    setBusy('theme');
    setError('');
    try {
      setState(await window.nocturne.saveTheme(theme));
      return true;
    } catch (reason) {
      reportError(reason);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function saveGameBehavior(behavior: GameBehavior): Promise<void> {
      setBusy('game-behavior');
      setError('');
      try {
        setState(await window.nocturne.saveGameBehavior(behavior));
        setNotice(text('Westron Launcher davranışı kaydedildi.'));
      } catch (reason) {
        reportError(reason);
      } finally {
        setBusy('');
      }
  }

  async function publishUpdate(): Promise<void> {
      setPublisherBusy(true);
      setError('');
      setNotice('');
      try {
        const result = await window.nocturne.publishUpdate();
        if (!result.cancelled) setNotice(`${text('Güncelleme yayımlandı.')} ${result.version ?? ''}`);
      } catch (reason) {
        reportError(reason);
      } finally {
        setPublisherBusy(false);
    }
  }

  useEffect(() => {
    if ((page !== 'mods' && !(page === 'library' && librarySection === 'mods'))
      || mods.length > 0 || !state || state.loader === 'vanilla') return;
    void Promise.resolve().then(() => window.nocturne.searchMods('')).then((result) => {
      setMods(result.projects);
      setModsTotal(result.totalHits);
    }).catch(reportError);
  }, [page, librarySection, mods.length, state?.gameVersion, state?.loader]);

  useEffect(() => {
    if (page === 'resourcepacks' || (page === 'library' && librarySection === 'resourcepacks')) {
      setQuery('');
      void searchPacks('resourcepack', '');
    }
    if (page === 'shaders' || (page === 'library' && librarySection === 'shaders')) {
      setQuery('');
      void searchPacks('shader', '');
    }
  }, [page, librarySection, state?.gameVersion]);

  useEffect(() => {
    if (page !== 'library' || !state) return undefined;
    let active = true;
    const projectIds = [...new Set([
      ...state.mods,
      ...state.resourcePacks,
      ...state.shaderPacks,
    ].flatMap((item) => item.projectId ? [item.projectId] : []))];
    const modFiles = state.mods.map((mod) => mod.name);
    if (projectIds.length) {
      void window.nocturne.getProjectMetadata(projectIds).then((metadata) => {
        if (active) setLibraryProjectMetadata(metadata);
      }).catch(reportError);
    } else {
      setLibraryProjectMetadata({});
    }
    if (modFiles.length) {
      void window.nocturne.getModArchiveMetadata(modFiles).then((metadata) => {
        if (active) setLibraryModMetadata(metadata);
      }).catch(reportError);
    } else {
      setLibraryModMetadata({});
    }
    return () => { active = false; };
  }, [page, state?.gameDirectory, state?.mods, state?.resourcePacks, state?.shaderPacks]);

  useEffect(() => {
    if (!dependencyPrompt && !versionPrompt && !removalPrompt && !profilePrompt) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setDependencyPrompt(null);
        setVersionPrompt(null);
        setRemovalPrompt(null);
        setProfilePrompt(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dependencyPrompt, versionPrompt, removalPrompt, profilePrompt, busy]);

  async function installMod(
    projectId: string,
    modName: string,
    selectedVersionId: string,
    confirmedDependencyIds?: string[],
  ) {
    const result = await perform(
      `mod:${projectId}`,
      () => window.nocturne.installModVersion(projectId, selectedVersionId, confirmedDependencyIds, true),
      (installResult) => {
        if (installResult.status === 'confirmation-required') return '';
        if (!installResult.files.length) return `${modName} yüklendi.`;
        return installResult.dependencies.length > 0
          ? `${modName} yüklendi; ${installResult.dependencies.length} gerekli mod da yüklendi.`
          : `${modName} yüklendi.`;
      },
    );
    if (!result) return;
    if (result.status === 'confirmation-required') {
      setDependencyPrompt({ projectId, modName, selectedVersionId, dependencies: result.dependencies });
      return;
    }
    setDependencyPrompt(null);
  }

  function requestModRemoval(fileName: string) {
    const mod = state?.mods.find((item) => item.name === fileName);
    if (mod) setRemovalPrompt({ name: mod.name, size: mod.size, type: 'mod' });
  }

  function requestPackRemoval(type: ContentType, fileName: string) {
    const items = type === 'resourcepack' ? state?.resourcePacks : state?.shaderPacks;
    const item = items?.find((entry) => entry.name === fileName);
    if (item) setRemovalPrompt({ ...item, type });
  }

  async function confirmModRemoval() {
    if (!removalPrompt) return;
    const removed = await perform(
      `remove:${removalPrompt.name}`,
      () => removalPrompt.type === 'mod'
        ? window.nocturne.removeMod(removalPrompt.name)
        : window.nocturne.removeContent(removalPrompt.type, removalPrompt.name),
      () => `${removalPrompt.name} kaldırıldı.`,
    );
    if (removed) setRemovalPrompt(null);
  }

  async function installPack(type: ContentType, projectId: string, title: string, selectedVersionId: string) {
    setBusy(`content:${type}:${projectId}`);
    setError('');
    setNotice('');
    try {
      const result = await window.nocturne.installContent(type, projectId, selectedVersionId, true);
      await refresh();
      setNotice(`${title} ${result.versionNumber} sürümü yüklendi.`);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
    }
  }

  async function checkForUpdates() {
    try {
      await window.nocturne.checkForUpdates();
    } catch (reason) {
      reportError(reason);
    }
  }

  async function downloadUpdate() {
    try {
      await window.nocturne.downloadUpdate();
    } catch (reason) {
      reportError(reason);
    }
  }

  async function signInMicrosoft() {
    setMicrosoftBusy(true);
    setError('');
    setNotice('');
    try {
      const account = await window.nocturne.signInMicrosoft();
      setMicrosoftAccount(account);
      setNotice(`${account.username} Microsoft hesabıyla giriş yaptı.`);
    } catch (reason) {
      if (reason instanceof Error && /Microsoft ile giriş iptal edildi/i.test(reason.message)) {
        setNotice(text('Microsoft hesabıyla giriş iptal edildi.'));
      } else {
        reportError(reason);
      }
    } finally {
      setMicrosoftBusy(false);
    }
  }

  async function cancelMicrosoftSignIn() {
    try {
      await window.nocturne.cancelMicrosoftSignIn();
    } catch (reason) {
      reportError(reason);
    }
  }

  async function signOutMicrosoft() {
    setMicrosoftBusy(true);
    setError('');
    try {
      setNotice(await window.nocturne.signOutMicrosoft());
      setMicrosoftAccount(null);
    } catch (reason) {
      reportError(reason);
    } finally {
      setMicrosoftBusy(false);
    }
  }


  return (
    <AppLanguageContext.Provider value={state?.language ?? 'en'}>
    <div className={`app-shell${mainWindowHighlighted ? ' is-highlighted' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('home'); }}>
          <span className="brand-mark"><img src={launcherIcon} alt="" draggable="false" /></span>
          <span className="brand-name">Westron<span>.</span><small>LAUNCHER</small></span>
        </a>

        <section className="sidebar-profile">
          <label htmlFor="game-version-select">{text('OYUN SÜRÜMÜ')}</label>
          <select
            id="game-version-select"
            value={state?.gameVersion ?? ''}
            disabled={!state || Boolean(busy)}
            onChange={(event) => {
              const nextVersion = event.currentTarget.value;
              if (state && nextVersion) void saveGameOptions(nextVersion, state.loader);
            }}
          >
            {gameVersions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.id}{version.kind === 'snapshot' ? ` (${text('son snapshot')})` : ''}
              </option>
            ))}
          </select>
          <label htmlFor="loader-select">{text('YÜKLEYİCİ')}</label>
          <select
            id="loader-select"
            value={state?.loader ?? 'fabric'}
            disabled={!state || Boolean(busy)}
            onChange={(event) => {
              const nextLoader = event.currentTarget.value;
              if (state && (nextLoader === 'vanilla' || nextLoader === 'fabric' || nextLoader === 'forge')) {
                void saveGameOptions(state.gameVersion, nextLoader);
              }
            }}
          >
            <option value="vanilla">Vanilla</option>
            <option value="fabric">Fabric</option>
            <option value="forge">Forge</option>
          </select>
          <button
            className="button button-ghost custom-profile-open"
            onClick={() => setCustomProfileManagerOpen(true)}
            disabled={!state || Boolean(busy)}
          >
            <Layers3 size={14} />
            <span>{text('Özel profiller')}</span>
            <small>{state?.selectedCustomProfileId
              ? state.customProfiles.find((profile) => profile.id === state.selectedCustomProfileId)?.name
              : state?.customProfiles.length ? state.customProfiles.length : ''}</small>
          </button>
          <small>{state?.selectedCustomProfileId
            ? text('Özel profil etkin.')
            : text('Her sürüm ayrı oyun klasörü kullanır.')}</small>
        </section>

        <div className="nav-label">{text('MENÜ')}</div>
        <nav className="nav-list">
          <NavButton icon={<Compass />} label={text('Genel Bakış')} active={page === 'home'} onClick={() => setPage('home')} />
          <NavButton
            icon={<Package />}
            label={text('Kütüphane')}
            active={page === 'library'}
            onClick={() => setPage('library')}
          />
          <NavButton icon={<Sparkles />} label={text('Modlar')} active={page === 'mods'} onClick={() => setPage('mods')} badge="MODRINTH" />
          <NavButton icon={<Image />} label={text('Kaynak Paketleri')} active={page === 'resourcepacks'} onClick={() => setPage('resourcepacks')} badge="MODRINTH" />
          <NavButton icon={<Sun />} label={text('Shader Paketleri')} active={page === 'shaders'} onClick={() => setPage('shaders')} badge="MODRINTH" />
          <NavButton icon={<Cpu />} label={text('Westron Launcher Modu')} active={page === 'performance'} onClick={() => setPage('performance')} />
          <NavButton icon={<Camera />} label={text('Ekran Görüntüleri')} active={page === 'screenshots'} onClick={() => setPage('screenshots')} count={screenshots.length} />
          <NavButton icon={<Shirt />} label={text('Skin & Pelerin')} active={page === 'appearance'} onClick={() => setPage('appearance')} />
          <NavButton icon={<Users />} label={text('Arkadaşlar')} active={page === 'friends'} onClick={() => setPage('friends')} />
          <NavButton icon={<UserRound />} label={text('Hesap')} active={page === 'account'} onClick={() => setPage('account')} />
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-card">
          <span className="online-dot" />
          <div><strong>{text('PROFILE READY')}</strong><small>Minecraft {state?.gameVersion ?? '…'}</small></div>
          <ShieldCheck size={16} className="sidebar-shield" />
        </div>
        <NavButton icon={<Settings2 />} label={text('Ayarlar')} active={page === 'settings'} onClick={() => setPage('settings')} />
        <div className="sidebar-foot">WESTRON LAUNCHER <span>•</span> v{state?.displayVersion ?? '…'}</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="window-controls">
            <button type="button" aria-label={text('Pencereyi küçült')} title={text('Pencereyi küçült')} onClick={() => { void window.nocturne.controlWindow('minimize'); }}><Minus size={14} /></button>
            <button type="button" aria-label={text('Pencereyi büyüt veya geri yükle')} title={text('Pencereyi büyüt veya geri yükle')} onClick={() => { void window.nocturne.controlWindow('maximize'); }}><Square size={13} /></button>
            <button type="button" className="window-close" aria-label={text('Kapat')} title={text('Kapat')} onClick={() => { void window.nocturne.controlWindow('close'); }}><X size={15} /></button>
          </div>
          <div className="breadcrumbs"><span>WESTRON LAUNCHER</span><ChevronDown size={13} /><strong>{pageTitle}</strong></div>
          <div className="topbar-right">
            <span className="top-version"><span className="online-dot" />{text('Westron Launcher Hazır')}</span>
            <button
              className="topbar-profile"
              type="button"
              aria-label={text('Hesap')}
              title={text('Hesap')}
              onClick={() => setPage('account')}
            >
            {westronProfile?.skin && !skinAvatarFailed
              ? <div className="avatar avatar-skin"><SkinFaceAvatar profile={westronProfile} size="small" onError={() => setSkinAvatarFailed(true)} /></div>
              : <div className="avatar">W</div>}
            </button>
          </div>
        </header>

        <div className="content">
          {friendNotifications.length > 0 && (
            <div className="friend-notifications" aria-live="polite">
              {friendNotifications.map((notification) => (
                <article
                  className={`friend-notification friend-notification-${notification.kind}`}
                  key={notification.id}
                  role={notification.kind === 'friend-request' ? 'alert' : 'status'}
                >
                  {notification.kind === 'call' ? <Phone size={17} /> : <Users size={17} />}
                  <button
                    className="friend-notification-copy"
                    type="button"
                    onClick={() => {
                      setPage('friends');
                      if (notification.kind !== 'call') dismissFriendNotification(notification.id);
                    }}
                  >
                    <strong>{notification.sender}</strong>
                    <span>{notification.message}</span>
                  </button>
                  <div className="friend-notification-actions">
                    {notification.actions?.map((action) => (
                      <button
                        className={`button button-${action.variant ?? 'secondary'} button-small`}
                        key={action.label}
                        type="button"
                        onClick={() => {
                          setPage('friends');
                          action.onClick();
                          if (action.dismissOnClick !== false) dismissFriendNotification(notification.id);
                        }}
                      >
                        {action.icon === 'phone' ? <Phone size={13} />
                          : action.icon === 'phone-off' ? <PhoneOff size={13} />
                            : null}
                        {action.label}
                      </button>
                    ))}
                    <button
                      className="friends-icon-action"
                      type="button"
                      aria-label={text('Kapat')}
                      onClick={(event) => {
                        event.stopPropagation();
                        dismissFriendNotification(notification.id);
                      }}
                    ><X size={14} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {error && <div className="toast toast-error"><X size={16} />{translateUi(state?.language ?? 'en', error)}</div>}
          {notice && <div className="toast toast-success"><Check size={16} />{translateUi(state?.language ?? 'en', notice)}</div>}
          {updateStatus && ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error'].includes(updateStatus.status) && (
            <UpdateBanner status={updateStatus} onCheck={() => { void checkForUpdates(); }} onDownload={() => { void downloadUpdate(); }} onRestart={() => {
              void window.nocturne.installUpdate().catch(reportError);
            }} />
          )}
          {installProgress && ['profile', 'fabric', 'launch'].includes(busy) && (
            <section
              className="game-install-banner"
              role="progressbar"
              aria-label={busy === 'launch'
                ? text('Oyun başlatılıyor…')
                : `${state?.loader.toUpperCase() ?? 'MINECRAFT'} ${state?.gameVersion ?? ''} ${text('İndiriliyor')}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={installPercent}
            >
              <div className="game-install-progress-label">
                <span>{busy === 'launch'
                  ? text('Oyun başlatılıyor…')
                  : `${state?.loader.toUpperCase()} ${state?.gameVersion} · ${text('İndiriliyor')}`}</span>
                <strong>%{installPercent}</strong>
              </div>
              <div className="game-install-progress-track">
                <span style={{ width: `${Math.max(0, Math.min(100, installProgress.overallPercent))}%` }} />
              </div>
            </section>
          )}

          {page === 'home' && (
            <HomePage
              state={state}
              microsoftAccount={microsoftAccount}
              microsoftBusy={microsoftBusy}
              offlineUsername={offlineUsername}
              setOfflineUsername={setOfflineUsername}
              busy={busy}
              onInstall={() => perform('profile', () => window.nocturne.installGameProfile(), (message) => message || 'Oyun profili hazır.')}
              onInstallMenu={() => perform('menu', () => window.nocturne.installMenu(), (message) => message || 'Westron Launcher arayüzü kuruldu.')}
              onLaunchGame={() => perform('launch', () => window.nocturne.launchGame(microsoftAccount
                ? { mode: 'microsoft' }
                : { mode: 'offline', offlineUsername }), (message) => message || 'Minecraft başlatıldı.')}
              onSignInMicrosoft={() => { void signInMicrosoft(); }}
              onCancelMicrosoftSignIn={() => { void cancelMicrosoftSignIn(); }}
              onSignOutMicrosoft={() => { void signOutMicrosoft(); }}
              onOpenSettings={() => setPage('settings')}
              onMods={() => setPage('mods')}
              onOpenFriends={() => setPage('friends')}
            />
          )}
          {page === 'mods' && (
            <ModsPage
              mods={mods}
              totalHits={modsTotal}
              query={query}
              setQuery={setQuery}
              busy={busy}
              installedMods={state?.mods ?? []}
              installedProjectIds={state?.modrinthModProjects ?? []}
              onSearch={search}
              onLoadMore={loadMoreMods}
              onInstall={(id, name) => { void requestVersionSelection('mod', id, name); }}
              onRemove={requestModRemoval}
              onOpenFolder={() => perform('folder', () => window.nocturne.openModsFolder())}
              loaderInstalled={Boolean(state?.loaderInstalled)}
              loader={state?.loader ?? 'fabric'}
              gameVersion={state?.gameVersion ?? ''}
              onInstallProfile={() => perform('profile', () => window.nocturne.installGameProfile(), (message) => message || 'Oyun profili hazır.')}
            />
          )}
          {(page === 'resourcepacks' || page === 'shaders') && (
            <ModrinthPackPage
              type={page === 'resourcepacks' ? 'resourcepack' : 'shader'}
              projects={packProjects}
              totalHits={packProjectsTotal}
              query={query}
              setQuery={setQuery}
              busy={busy}
              installedFiles={page === 'resourcepacks' ? state?.resourcePacks ?? [] : state?.shaderPacks ?? []}
              installedProjectIds={page === 'resourcepacks' ? state?.resourcePackProjects ?? [] : state?.shaderProjects ?? []}
              onSearch={() => { void searchPacks(page === 'resourcepacks' ? 'resourcepack' : 'shader'); }}
              onLoadMore={() => { void loadMorePacks(page === 'resourcepacks' ? 'resourcepack' : 'shader'); }}
              onInstall={(id, title) => { void requestVersionSelection(page === 'resourcepacks' ? 'resourcepack' : 'shader', id, title); }}
              onRemove={(fileName) => requestPackRemoval(page === 'resourcepacks' ? 'resourcepack' : 'shader', fileName)}
              onOpenFolder={() => perform('folder', () => window.nocturne.openContentFolder(page === 'resourcepacks' ? 'resourcepack' : 'shader'))}
              gameVersion={state?.gameVersion ?? ''}
              loader={state?.loader ?? 'fabric'}
              fabricInstalled={Boolean(state?.fabricInstalled)}
              irisInstalled={Boolean(state?.modrinthModProjects.includes(IRIS_PROJECT_ID))}
              onInstallFabric={() => { void ensureFabricProfile(); }}
              onInstallIris={() => { void requestVersionSelection('mod', IRIS_PROJECT_ID, 'Iris shader altyapısı'); }}
            />
          )}
          {page === 'performance' && (
            <PerformanceModesPage
              mode={state?.performanceMode ?? 'default'}
              includeShader={qualityShaderEnabled}
              themeEnabled={performanceThemeEnabled}
              loader={state?.loader ?? 'vanilla'}
              loaderInstalled={Boolean(state?.loaderInstalled)}
              gameRunning={Boolean(state?.gameRunning)}
              busy={busy}
              onShaderChange={setQualityShaderEnabled}
              onThemeChange={setPerformanceThemeEnabled}
              onSelect={(mode) => {
                void applyPerformanceMode(mode, mode === 'quality' && state?.loader === 'fabric' && qualityShaderEnabled);
              }}
            />
          )}
          {page === 'library' && (
            <LibraryPage
              section={librarySection}
              onSectionChange={setLibrarySection}
            >
              <InstalledLibrarySection
                section={librarySection}
                mods={state?.mods ?? []}
                resourcePacks={state?.resourcePacks ?? []}
                shaderPacks={state?.shaderPacks ?? []}
                projectMetadata={libraryProjectMetadata}
                modMetadata={libraryModMetadata}
                searchQuery={libraryQueries[librarySection]}
                onSearchQueryChange={(searchQuery) => setLibraryQueries((queries) => ({
                  ...queries,
                  [librarySection]: searchQuery,
                }))}
                busy={busy}
                onRemoveMod={requestModRemoval}
                onRemovePack={requestPackRemoval}
                onInstallProject={(type, projectId, title) => { void requestVersionSelection(type, projectId, title); }}
                onOpenFolder={() => perform('folder', () => librarySection === 'mods'
                  ? window.nocturne.openModsFolder()
                  : window.nocturne.openContentFolder(librarySection === 'resourcepacks' ? 'resourcepack' : 'shader'))}
              />
            </LibraryPage>
          )}
          {page === 'screenshots' && (
            <ScreenshotsPage
              screenshots={screenshots}
              status={screenshotStatus}
              busy={busy}
              onRefresh={() => { void refreshScreenshots(); }}
              onDelete={async (fileName) => {
                await perform(`screenshot:${fileName}`, async () => {
                  await window.nocturne.deleteScreenshot(fileName);
                  screenshotLoadGenerationRef.current += 1;
                  setScreenshots((items) => items.filter((item) => item.name !== fileName));
                  setScreenshotStatus('ready');
                }, () => text('Ekran görüntüsü silindi.'));
              }}
              onOpenFolder={() => perform('folder', () => window.nocturne.openScreenshotsFolder())}
            />
          )}
          {page === 'appearance' && (
            <AppearancePage
              account={westronAccount}
              profile={westronProfile}
              onProfileChange={setWestronProfile}
              onOpenAccount={() => setPage('account')}
            />
          )}
          {page === 'account' && (
            <>
              <PageHeading eyebrow={text('HESAP')} title={text('Hesap')} description={text('Westron hesap bilgilerini ve giriş ayarlarını yönet.')} />
              <AccountPage
                account={westronAccount}
                profile={westronProfile}
                onAccountChange={setWestronAccount}
                onProfileChange={setWestronProfile}
              />
            </>
          )}
          {FriendsPageComponent ? (
            <FriendsPageComponent
              account={westronAccount}
              gameRunning={Boolean(state?.gameRunning)}
              language={state?.language ?? 'en'}
              profileAvatarShape={profileAvatarShape}
              onProfileAvatarShapeChange={(shape) => {
                setProfileAvatarShape(shape);
                localStorage.setItem('westron-profile-avatar-shape', shape);
                localStorage.setItem('westron-call-avatar-shape', shape);
              }}
              isActive={page === 'friends'}
              onOpenAccount={() => setPage('account')}
              onOpenScreenshots={() => setPage('screenshots')}
              onOpenFriends={() => setPage('friends')}
              onNotification={pushFriendNotification}
              onDismissNotification={dismissFriendNotification}
            />
          ) : page === 'friends' ? (
            <div className="empty-state screenshot-loading" role="status" aria-label={text('Arkadaşlar')}>
              <LoaderCircle className="spin" size={22} />
            </div>
          ) : null}
          {page === 'settings' && (
            <SettingsPage
              state={state}
              language={state?.language ?? 'en'}
              onLanguageChange={(language: LauncherState['language']) => { void saveLanguage(language); }}
              theme={state?.theme ?? 'dark'}
              onThemeChange={(theme: AppTheme) => { void saveTheme(theme); }}
              busy={busy}
              updateStatus={updateStatus}
              onCheckUpdates={() => { void checkForUpdates(); }}
              gameBehavior={state?.gameBehavior ?? 'close-on-game-launch'}
              onGameBehaviorChange={(behavior) => { void saveGameBehavior(behavior); }}
              onOpenProfilesFolder={() => perform('folder', () => window.nocturne.openProfilesFolder())}
              onOpenSelectedProfileFolder={() => perform('folder', () => window.nocturne.openSelectedProfileFolder())}
              publisherAccount={westronAccount}
              publisherBusy={publisherBusy}
              onPublishUpdate={() => { void publishUpdate(); }}
              performanceThemeChoice={performanceThemeChoice}
              onPerformanceThemeChoiceChange={(choice) => {
                setPerformanceThemeChoice(choice);
                localStorage.setItem('westron-performance-theme', choice);
              }}
              profileAvatarShape={profileAvatarShape}
              onProfileAvatarShapeChange={(shape) => {
                setProfileAvatarShape(shape);
                localStorage.setItem('westron-profile-avatar-shape', shape);
                localStorage.setItem('westron-call-avatar-shape', shape);
              }}
              onOpenVoiceSettings={() => {
                sessionStorage.setItem('westron-open-voice-settings', 'true');
                setPage('friends');
              }}
            />
          )}
        </div>
      </main>
      {versionPrompt && (
        <VersionSelectionModal
          type={versionPrompt.type}
          title={versionPrompt.title}
          versions={versionPrompt.versions}
          selectedVersionId={versionPrompt.selectedVersionId}
          busy={Boolean(busy)}
          onSelectionChange={(selectedVersionId) => setVersionPrompt((current) =>
            current ? { ...current, selectedVersionId } : current)}
          onCancel={() => setVersionPrompt(null)}
          onConfirm={installSelectedVersion}
        />
      )}
      {dependencyPrompt && (
        <DependencyConfirmationModal
          modName={dependencyPrompt.modName}
          dependencies={dependencyPrompt.dependencies}
          busy={Boolean(busy)}
          onCancel={() => setDependencyPrompt(null)}
          onConfirm={() => {
            void installMod(
              dependencyPrompt.projectId,
              dependencyPrompt.modName,
              dependencyPrompt.selectedVersionId,
              dependencyPrompt.dependencies.map((dependency) => dependency.projectId),
            );
          }}
        />
      )}
      {removalPrompt && (
        <RemoveConfirmationModal
          fileName={removalPrompt.name}
          size={removalPrompt.size}
          contentType={removalPrompt.type}
          busy={busy === `remove:${removalPrompt.name}`}
          onCancel={() => setRemovalPrompt(null)}
          onConfirm={() => { void confirmModRemoval(); }}
        />
      )}
      {profilePrompt && (
        <NewProfileConfirmationModal
          gameVersion={profilePrompt.gameVersion}
          loader={profilePrompt.loader}
          profileDirectory={profilePrompt.profileDirectory}
          dontShowAgain={dismissProfileNotice}
          onDontShowAgain={setDismissProfileNotice}
          onCancel={() => setProfilePrompt(null)}
          onConfirm={() => { void saveGameOptions(profilePrompt.gameVersion, profilePrompt.loader, true); }}
          busy={busy === 'profile-options'}
          language={state?.language ?? 'en'}
        />
      )}
      {customProfileManagerOpen && state && (
        <CustomProfileManagerModal
          state={state}
          gameVersions={gameVersions}
          busy={busy.startsWith('custom-profile-')}
          language={state.language}
          onClose={() => setCustomProfileManagerOpen(false)}
          onSelect={selectCustomProfile}
          onSave={saveCustomProfile}
          onDelete={deleteCustomProfile}
          onChooseDirectory={chooseCustomProfileDirectory}
        />
      )}
      {languageSetupRequired && (
        <LanguageSetupModal
          language={setupLanguage}
          onLanguageChange={(value) => { if (isAppLanguage(value)) setSetupLanguage(value); }}
          busy={busy === 'language'}
          error={error}
          onContinue={() => { void saveLanguage(setupLanguage); }}
        />
      )}
      {welcomeIntroVisible && (
        <WelcomeIntro
          language={state?.language ?? 'en'}
          onComplete={() => {
            localStorage.removeItem('westron-launcher-intro-pending');
            setWelcomeIntroVisible(false);
          }}
        />
      )}
    </div>
    </AppLanguageContext.Provider>
  );
}

function LanguageSetupModal({ language, onLanguageChange, busy, error, onContinue }: {
  language: AppLanguage;
  onLanguageChange: (language: string) => void;
  busy: boolean;
  error: string;
  onContinue: () => void;
}) {
  const t = (key: string) => translateUi(language, key);
  return (
    <div className="dependency-modal-backdrop language-setup-backdrop">
      <section className="dependency-modal language-setup-modal" role="dialog" aria-modal="true" aria-labelledby="language-setup-title">
        <div className="card-icon violet"><Languages size={18} /></div>
        <p className="eyebrow">{t('language')}</p>
        <h2 id="language-setup-title">{t('chooseLanguage')}</h2>
        <p className="language-setup-description">{t('setupDescription')}</p>
        <label className="language-setup-select">
          <span>{t('displayLanguage')}</span>
          <select value={language} onChange={(event) => onLanguageChange(event.target.value)} disabled={busy}>
            {SUPPORTED_LANGUAGES.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}
          </select>
        </label>
        {error && <p className="account-message account-error">{error}</p>}
        <div className="dependency-modal-actions">
          <button className="button button-primary" onClick={onContinue} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}
            {t('continue')}
          </button>
        </div>
      </section>
    </div>
  );
}

function UpdateBanner({ status, onCheck, onDownload, onRestart }: {
  status: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}) {
  const t = useUiText();
  const downloading = status.status === 'downloading';
  return (
    <section className={`update-banner update-${status.status}`} aria-live="polite">
      <div className="update-banner-icon">
        {status.status === 'checking' || downloading
          ? <LoaderCircle className="spin" size={19} />
          : status.status === 'downloaded' || status.status === 'up-to-date' ? <Check size={19} /> : <ArrowDownToLine size={19} />}
      </div>
      <div className="update-banner-copy">
        <div className="update-banner-heading">
          <strong>{status.status === 'available' ? `Westron Launcher ${status.version} ${t('hazır')}` : status.status === 'downloaded' ? t('Güncelleme kuruluma hazır') : status.status === 'up-to-date' ? t('Yeni güncelleme yok') : status.status === 'error' ? t('Güncelleme tamamlanamadı') : t('Westron Launcher güncelleniyor')}</strong>
          <span>{t('Şu anki sürüm')} {status.currentVersion}</span>
        </div>
        <p>{status.message ? t(status.message) : ''}</p>
        {downloading && (
          <div className="update-progress" aria-label={`İndirme yüzde ${status.percent ?? 0}`}>
            <span style={{ width: `${status.percent ?? 0}%` }} />
          </div>
        )}
        {status.status === 'available' && status.releaseNotes && <details className="update-notes"><summary>{t('Sürüm notlarını gör')}</summary><p>{status.releaseNotes}</p></details>}
      </div>
      <div className="update-banner-actions">
        {status.status === 'available' && <button className="button button-primary button-small" onClick={onDownload}><ArrowDownToLine size={14} />{t('İndir')}</button>}
        {status.status === 'downloaded' && <button className="button button-primary button-small" onClick={onRestart}><Play size={14} />{t('Yeniden başlat')}</button>}
        {status.status === 'error' && <button className="button button-secondary button-small" onClick={onCheck}>{t('Tekrar dene')}</button>}
        {status.status === 'checking' && <span className="update-checking">{t('Kontrol ediliyor')}</span>}
      </div>
    </section>
  );
}

function DependencyConfirmationModal({ modName, dependencies, busy, onCancel, onConfirm }: {
  modName: string;
  dependencies: ModDependency[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useUiText();
  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section
        className="dependency-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dependency-modal-title"
        aria-describedby="dependency-modal-description"
      >
        <div className="dependency-modal-icon"><Package size={21} /></div>
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label={t('Pencereyi kapat')}>
          <X size={17} />
        </button>
        <div className="eyebrow">{t('MOD BAĞIMLILIKLARI')}</div>
        <h2 id="dependency-modal-title">{t('Ek modlar gerekiyor')}</h2>
        <p id="dependency-modal-description">
          <strong>{modName}</strong> {t('modunun çalışması için aşağıdaki modlar da yüklenmeli.')}
          {t('Onayladığında hepsi birlikte indirilecek.')}
        </p>
        <div className="dependency-list" aria-label={t('İndirilecek gerekli modlar')}>
          {dependencies.map((dependency) => (
            <div className="dependency-item" key={dependency.projectId}>
              <span className="dependency-item-icon"><Package size={15} /></span>
              <span>{dependency.title}</span>
              <Check size={15} className="dependency-item-check" />
            </div>
          ))}
        </div>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>{t('Vazgeç')}</button>
          <button className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}
            {t('Gerekli modlarla indir')}
          </button>
        </div>
      </section>
    </div>
  );
}

function VersionSelectionModal({
  type,
  title,
  versions,
  selectedVersionId,
  busy,
  onSelectionChange,
  onCancel,
  onConfirm,
}: {
  type: 'mod' | ContentType;
  title: string;
  versions: ModrinthVersionOption[];
  selectedVersionId: string;
  busy: boolean;
  onSelectionChange: (versionId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useUiText();
  const label = type === 'mod' ? t('Mod') : type === 'resourcepack' ? t('Kaynak paketleri') : t('Shader paketleri');
  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="dependency-modal" role="dialog" aria-modal="true" aria-labelledby="version-modal-title">
        <div className="dependency-modal-icon"><Package size={21} /></div>
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label={t('Pencereyi kapat')}>
          <X size={17} />
        </button>
        <div className="eyebrow">{label}</div>
        <h2 id="version-modal-title">{title}</h2>
        <label className="project-version-select">
          <span>{t('Sürüm seç')}</span>
          <select value={selectedVersionId} onChange={(event) => onSelectionChange(event.currentTarget.value)} disabled={busy}>
            {versions.map((version) => (
              <option value={version.id} key={version.id}>
                {version.versionNumber}{version.name && version.name !== version.versionNumber ? ` · ${version.name}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="project-version-meta">
          <span>{versions.find((version) => version.id === selectedVersionId)?.gameVersions.join(', ')}</span>
          <span>{versions.find((version) => version.id === selectedVersionId)?.loaders.join(', ')}</span>
        </div>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>{t('Vazgeç')}</button>
          <button className="button button-primary" onClick={onConfirm} disabled={busy || !selectedVersionId}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}
            {t('Seçili sürümü yükle')}
          </button>
        </div>
      </section>
    </div>
  );
}

function RemoveConfirmationModal({ fileName, size, contentType, busy, onCancel, onConfirm }: {
  fileName: string;
  size: number;
  contentType: 'mod' | ContentType;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useUiText();
  const contentLabel = contentType === 'mod'
    ? t('Mod')
    : contentType === 'resourcepack' ? t('Kaynak paketini') : t('Shader paketini');
  const folderLabel = contentType === 'mod'
    ? 'mods'
    : contentType === 'resourcepack' ? 'resourcepacks' : 'shaderpacks';
  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="dependency-modal remove-modal" role="dialog" aria-modal="true" aria-labelledby="remove-modal-title">
        <div className="dependency-modal-icon remove-modal-icon"><Trash2 size={20} /></div>
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label={t('Pencereyi kapat')}><X size={17} /></button>
        <div className="eyebrow">{contentType === 'mod' ? t('MOD KÜTÜPHANESİ') : t('MODRINTH PAKETLERİ')}</div>
        <h2 id="remove-modal-title">{contentLabel} {t('kaldırmak istiyor musun?')}</h2>
        <p><strong>{fileName}</strong> ({formatBytes(size)}) Minecraft {folderLabel} {t('klasöründen kaldırılacak. Bu işlem geri alınamaz.')}</p>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>{t('Vazgeç')}</button>
          <button className="button button-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
            {t('Evet, kaldır')}
          </button>
        </div>
      </section>
    </div>
  );
}

function WelcomeIntro({ language, onComplete }: { language: AppLanguage; onComplete: () => void }) {
  const text = (value: string) => translateUi(language, value);
  return (
    <div className="welcome-intro-backdrop">
      <section className="welcome-intro" role="dialog" aria-modal="true" aria-labelledby="welcome-intro-title">
        <div className="welcome-intro-art" aria-hidden="true">
          <span className="welcome-intro-orbit" />
          <span className="welcome-intro-cube welcome-intro-cube-main"><img src={launcherIcon} alt="" /></span>
          <span className="welcome-intro-cube welcome-intro-cube-small" />
          <span className="welcome-intro-spark welcome-intro-spark-one" />
          <span className="welcome-intro-spark welcome-intro-spark-two" />
        </div>
        <p className="eyebrow">WESTRON LAUNCHER</p>
        <h1 id="welcome-intro-title">Westron Launcher Artık Çıktı!</h1>
        <p>Çok Daha Özelleştirilebilir Ve Kullanışlı Launcher.</p>
        <button className="button button-primary welcome-intro-close" type="button" onClick={onComplete}>
          {text('Kapat')}
        </button>
      </section>
    </div>
  );
}

function AppearanceRemovalModal({ appearanceType, busy, onCancel, onConfirm }: {
  appearanceType: 'skin' | 'cape' | 'elytra';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useUiText();
  const isSkin = appearanceType === 'skin';
  const title = isSkin
    ? t("Skin'in silinecek. Emin misin?")
    : appearanceType === 'cape'
      ? t('Pelerinin silinecek. Emin misin?')
      : t('Elitra dokusu silinecek. Emin misin?');
  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="dependency-modal remove-modal" role="dialog" aria-modal="true" aria-labelledby="appearance-remove-title" aria-describedby="appearance-remove-description">
        <div className="dependency-modal-icon remove-modal-icon"><Trash2 size={20} /></div>
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label={t('Pencereyi kapat')}><X size={17} /></button>
        <div className="eyebrow">{t('KİŞİSELLEŞTİRME')}</div>
        <h2 id="appearance-remove-title">{title}</h2>
        <p id="appearance-remove-description">{t('Bu işlem geri alınamaz.')}</p>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>{t('Vazgeç')}</button>
          <button className="button button-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
            {isSkin ? t("Evet, skin'i sil") : t("Evet, pelerini sil")}
          </button>
        </div>
      </section>
    </div>
  );
}

function NewProfileConfirmationModal({ gameVersion, loader, profileDirectory, dontShowAgain, onDontShowAgain, onCancel, onConfirm, busy, language }: {
  gameVersion: string;
  loader: LauncherState['loader'];
  profileDirectory: string;
  dontShowAgain: boolean;
  onDontShowAgain: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  language: LauncherState['language'];
}) {
  const t = (value: string) => translateUi(language, value);
  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="dependency-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
        <div className="dependency-modal-icon"><HardDrive size={21} /></div>
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label={t('Pencereyi kapat')}>
          <X size={17} />
        </button>
        <div className="eyebrow">{t('YENİ OYUN PROFİLİ')}</div>
        <h2 id="profile-modal-title">{t('Yeni oyun klasörü oluşturulsun mu?')}</h2>
        <p>
          {t('Minecraft')} {gameVersion} ({loader}) {t('için ayrı bir klasör oluşturulacak. Mevcut oyun dosyalarınız değiştirilmeyecek.')}
        </p>
        <code className="profile-directory">{profileDirectory}</code>
        <label className="profile-notice-checkbox">
          <input type="checkbox" checked={dontShowAgain} onChange={(event) => onDontShowAgain(event.target.checked)} />
          <span>{t('Bunu bir daha gösterme')}</span>
        </label>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>{t('Vazgeç')}</button>
          <button className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {t('Profili oluştur')}
          </button>
        </div>
      </section>
    </div>
  );
}

function CustomProfileManagerModal({ state, gameVersions, busy, language, onClose, onSelect, onSave, onDelete, onChooseDirectory }: {
  state: LauncherState;
  gameVersions: MinecraftVersionOption[];
  busy: boolean;
  language: LauncherState['language'];
  onClose: () => void;
  onSelect: (profileId: string) => Promise<LauncherState | null>;
  onSave: (input: CustomGameProfileInput, profileId?: string) => Promise<LauncherState | null>;
  onDelete: (profileId: string, deleteFiles: boolean) => Promise<{ state: LauncherState; cleanupError: string | null } | null>;
  onChooseDirectory: () => Promise<string | null>;
}) {
  const t = (value: string) => translateUi(language, value);
  const [selectedId, setSelectedId] = useState(
    state.selectedCustomProfileId ?? state.customProfiles[0]?.id ?? '',
  );
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [formError, setFormError] = useState('');
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [draft, setDraft] = useState<CustomGameProfileInput>({
    name: '',
    gameVersion: state.gameVersion,
    loader: state.loader,
    memoryMb: Math.min(4096, state.maxCustomMemoryMb),
    directory: '',
  });
  const selectedProfile = state.customProfiles.find((profile) => profile.id === selectedId) ?? null;
  const memoryLimitMb = Math.max(state.maxCustomMemoryMb, formMode === 'edit' ? selectedProfile?.memoryMb ?? 0 : 0);

  useEffect(() => {
    setSelectedId(state.selectedCustomProfileId ?? state.customProfiles[0]?.id ?? '');
  }, [state.selectedCustomProfileId, state.customProfiles]);

  function startCreate() {
    setFormMode('create');
    setDeletePrompt(false);
    setFormError('');
    setDraft({
      name: '',
      gameVersion: state.gameVersion,
      loader: state.loader,
      memoryMb: Math.max(1024, Math.min(4096, state.maxCustomMemoryMb)),
      directory: '',
    });
  }

  function startEdit() {
    if (!selectedProfile) return;
    setFormMode('edit');
    setDeletePrompt(false);
    setFormError('');
    setDraft({
      name: selectedProfile.name,
      gameVersion: selectedProfile.gameVersion,
      loader: selectedProfile.loader,
      memoryMb: selectedProfile.memoryMb,
      directory: selectedProfile.directory,
    });
  }

  async function submitProfile() {
    if (!draft.name.trim() || draft.name.trim().length > 40) {
      setFormError(t('Profil adı 1-40 karakter arasında olmalı.'));
      return;
    }
    if (!Number.isSafeInteger(draft.memoryMb)
      || draft.memoryMb < 1024
      || draft.memoryMb > memoryLimitMb) {
      setFormError(t('RAM değeri kullanılabilir aralığın dışında.'));
      return;
    }
    const savedState = await onSave({
      ...draft,
      directory: formMode === 'create' ? (draft.directory?.trim() || undefined) : selectedProfile?.directory,
    }, formMode === 'edit' ? selectedProfile?.id : undefined);
    if (!savedState) return;
    if (formMode === 'create') {
      setSelectedId(savedState.selectedCustomProfileId ?? '');
    }
    setFormMode(null);
    setFormError('');
  }

  async function useSelectedProfile() {
    if (!selectedId) return;
    const nextState = await onSelect(selectedId);
    if (nextState) onClose();
  }

  async function confirmDeleteProfile() {
    if (!selectedProfile) return;
    const result = await onDelete(selectedProfile.id, deleteFiles);
    if (!result) return;
    setSelectedId(
      result.state.selectedCustomProfileId ?? result.state.customProfiles[0]?.id ?? '',
    );
    setDeletePrompt(false);
    setDeleteFiles(false);
    setFormMode(null);
  }

  async function chooseDirectory() {
    const directory = await onChooseDirectory();
    if (directory) {
      setDraft((current) => ({ ...current, directory }));
      setFormError('');
    }
  }

  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dependency-modal custom-profile-modal" role="dialog" aria-modal="true" aria-labelledby="custom-profile-title">
        <button className="dependency-modal-close" onClick={onClose} disabled={busy} aria-label={t('Pencereyi kapat')}>
          <X size={17} />
        </button>
        {formMode === null && (
          <>
            <div className="dependency-modal-icon"><Layers3 size={21} /></div>
            <div className="eyebrow">{t('OYUN PROFİLLERİ')}</div>
          </>
        )}
        <h2 id="custom-profile-title">
          {formMode === 'edit' ? t('Özel profili düzenle') : formMode === 'create' ? t('Yeni özel profil') : t('Özel profiller')}
        </h2>
        {formMode === null && (
          <>
            <p>{t('Sürüm, yükleyici, RAM ve oyun klasörü ayarlarını profillere göre sakla.')}</p>
            <label className="custom-profile-field">
              <span>{t('Profil seç')}</span>
              <select
                value={selectedId}
                disabled={busy || deletePrompt}
                onChange={(event) => setSelectedId(event.currentTarget.value)}
              >
                {state.customProfiles.length === 0
                  ? <option value="" disabled>{t('Profil bulunmuyor')}</option>
                  : state.customProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name} — {profile.gameVersion} {profile.loader}</option>
                  ))}
              </select>
            </label>
            {selectedProfile && (
              <div className="custom-profile-summary">
                <span>{selectedProfile.memoryMb / 1024} {t('GB')} · {selectedProfile.loader}</span>
                <code>{selectedProfile.directory}</code>
              </div>
            )}
          </>
        )}

        {deletePrompt ? (
          <div className="custom-profile-delete-confirm" role="alertdialog" aria-labelledby="custom-profile-delete-title">
            <h3 id="custom-profile-delete-title">{t('Özel profili silmek istediğinizden emin misiniz?')}</h3>
            <p>{t('Seçilen profil klasöründeki her şey silinir; modlar, dünyalar ve ayarlar da buna dahildir.')}</p>
            <label className="custom-profile-delete-option">
              <input
                type="radio"
                name="custom-profile-delete-files"
                checked={!deleteFiles}
                onChange={() => setDeleteFiles(false)}
                disabled={busy}
              />
              <span>
                <strong>{t('Yalnızca profili sil')}</strong>
                <small>{t('Oyun dosyaları klasörde kalır.')}</small>
              </span>
            </label>
            <label className="custom-profile-delete-option">
              <input
                type="radio"
                name="custom-profile-delete-files"
                checked={deleteFiles}
                onChange={() => setDeleteFiles(true)}
                disabled={busy || state.gameRunning}
              />
              <span>
                <strong>{t('Profil dosyalarını da sil')}</strong>
                <small>{t('Profil klasörünü ve içindeki tüm dosyaları kalıcı olarak sil.')}</small>
              </span>
            </label>
            {state.gameRunning && <p className="custom-profile-delete-warning">{t('Oyun çalışırken profil dosyaları silinemez.')}</p>}
            <div className="dependency-modal-actions">
              <button
                className="button button-ghost"
                onClick={() => { setDeletePrompt(false); setDeleteFiles(false); }}
                disabled={busy}
              >
                {t('Vazgeç')}
              </button>
              <button
                className="button button-danger"
                onClick={() => { void confirmDeleteProfile(); }}
                disabled={busy || (deleteFiles && state.gameRunning)}
              >
                {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                {t(deleteFiles ? 'Profil ve dosyaları sil' : 'Profili sil')}
              </button>
            </div>
          </div>
        ) : !formMode ? (
          <div className="custom-profile-actions">
            <button className="button button-secondary" onClick={() => { void useSelectedProfile(); }} disabled={busy || !selectedId}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {t('Bu profili kullan')}
            </button>
            <button className="button button-primary" onClick={startCreate} disabled={busy}>
              <Plus size={15} />{t('Özel profil oluştur')}
            </button>
            {selectedProfile && (
              <>
                <button className="button button-ghost" onClick={startEdit} disabled={busy}>
                  <Settings2 size={15} />{t('Profili düzenle')}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="custom-profile-form">
            <label className="custom-profile-field">
              <span>{t('Profil adı')}</span>
              <input
                type="text"
                maxLength={40}
                value={draft.name}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setDraft((current) => ({ ...current, name }));
                  setFormError('');
                }}
                placeholder={t('Profil adını yaz')}
                disabled={busy}
              />
            </label>
            <div className="custom-profile-form-grid">
              <label className="custom-profile-field">
                <span>{t('OYUN SÜRÜMÜ')}</span>
                <select
                  value={draft.gameVersion}
                  onChange={(event) => {
                    const gameVersion = event.currentTarget.value;
                    setDraft((current) => ({ ...current, gameVersion }));
                  }}
                  disabled={busy}
                >
                  {!gameVersions.some((version) => version.id === draft.gameVersion) && (
                    <option value={draft.gameVersion}>{draft.gameVersion}</option>
                  )}
                  {gameVersions.map((version) => <option key={version.id} value={version.id}>{version.id}</option>)}
                </select>
              </label>
              <label className="custom-profile-field">
                <span>{t('YÜKLEYİCİ')}</span>
                <select
                  value={draft.loader}
                  onChange={(event) => {
                    const loader = event.currentTarget.value;
                    if (loader === 'vanilla' || loader === 'fabric' || loader === 'forge') {
                      setDraft((current) => ({ ...current, loader }));
                    }
                  }}
                  disabled={busy}
                >
                  <option value="vanilla">Vanilla</option>
                  <option value="fabric">Fabric</option>
                  <option value="forge">Forge</option>
                </select>
              </label>
            </div>
            <label className="custom-profile-field">
              <span>{t('Ayrılacak RAM')} · {t('GB')}</span>
              <input
                type="number"
                min={1}
                max={memoryLimitMb / 1024}
                step={0.5}
                value={draft.memoryMb / 1024}
                onChange={(event) => {
                  const memoryGb = Number(event.currentTarget.value);
                  setDraft((current) => ({ ...current, memoryMb: Number.isFinite(memoryGb) ? Math.round(memoryGb * 1024) : 0 }));
                  setFormError('');
                }}
                disabled={busy}
              />
            </label>
            <div className="custom-profile-field">
              <span>{t('Profil klasörü')}</span>
              {formMode === 'create' ? (
                <div className="custom-profile-directory-picker">
                  <code>{draft.directory || t('Varsayılan özel profil klasörü kullanılacak.')}</code>
                  <button className="button button-ghost" onClick={() => { void chooseDirectory(); }} disabled={busy}>
                    <FolderOpen size={15} />{t('Klasör seç')}
                  </button>
                </div>
              ) : (
                <code className="custom-profile-path">{draft.directory}</code>
              )}
            </div>
            {formError && <p className="custom-profile-error" role="alert">{formError}</p>}
            <div className="dependency-modal-actions">
              <button className="button button-ghost" onClick={() => { setFormMode(null); setFormError(''); }} disabled={busy}>
                {t('Vazgeç')}
              </button>
              <button className="button button-primary" onClick={() => { void submitProfile(); }} disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                {t('Kaydet')}
              </button>
            </div>
            {formMode === 'edit' && (
              <button
                className="button button-danger custom-profile-delete-submit"
                onClick={() => { setDeleteFiles(false); setDeletePrompt(true); }}
                disabled={busy}
              >
                <Trash2 size={15} />{t('Profili sil')}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
function NavButton({ icon, label, active, onClick, badge, count }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: string; count?: number;
}) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span><span>{label}</span>
      {badge && <small className="nav-badge">{badge}</small>}
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

function PageHeading({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
      {children}
    </div>
  );
}

function PerformanceModesPage({
  mode,
  includeShader,
  themeEnabled,
  loader,
  loaderInstalled,
  gameRunning,
  busy,
  onShaderChange,
  onThemeChange,
  onSelect,
}: {
  mode: LauncherState['performanceMode'];
  includeShader: boolean;
  themeEnabled: boolean;
  loader: LauncherState['loader'];
  loaderInstalled: boolean;
  gameRunning: boolean;
  busy: string;
  onShaderChange: (enabled: boolean) => void;
  onThemeChange: (enabled: boolean) => void;
  onSelect: (mode: LauncherState['performanceMode']) => void;
}) {
  const t = useUiText();
  const presetsSupported = loader !== 'vanilla';
  const shaderSupported = loader === 'fabric';
  const cards = [
    {
      mode: 'default' as const,
      title: 'Varsayılan Westron Launcher',
      description: 'Westron Launcher modlarının etkisini kaldır; kişisel yüklemelerin korunur.',
      icon: <RotateCcw size={19} />,
      style: '',
    },
    {
      mode: 'performance' as const,
      title: 'Ultra Performans',
      description: 'FPS değerini artırmaya odaklı, seçili sürümle uyumlu modları kur.',
      icon: <Cpu size={19} />,
      style: 'mode-performance',
    },
    {
      mode: 'quality' as const,
      title: 'Ultra Kalite',
      description: 'Distant Horizons ve görsel iyileştirmelerle oyun görüntüsünü geliştir.',
      icon: <Sun size={19} />,
      style: 'mode-quality',
    },
  ];

  return (
    <>
      <PageHeading
        eyebrow={t('OYUN MODLARI')}
        title={t('Westron Launcher Modu')}
        description={t('Oyun deneyimini seçili sürüme uygun hazır profillerle değiştir.')}
      />
      {gameRunning && (
        <div className="inline-callout"><Cpu size={17} /><span>{t('Oyun çalışırken performans modu değiştirilemez.')}</span></div>
      )}
      {!presetsSupported && (
        <div className="inline-callout"><Cpu size={17} /><span>{t('Performans ve kalite modları için Fabric veya Forge seç.')}</span></div>
      )}
      {presetsSupported && !loaderInstalled && (
        <div className="inline-callout"><Cpu size={17} /><span>{t('Önce seçili oyun profilini kur.')}</span></div>
      )}
      <div className="performance-mode-grid">
        {cards.map((card) => {
          const selected = mode === card.mode;
          const unavailable = card.mode !== 'default' && (!presetsSupported || !loaderInstalled);
          const cardBusy = busy === `performance:${card.mode}`;
          return (
            <article
              key={card.mode}
              className={`performance-mode-card ${card.style} ${selected ? 'selected' : ''}`}
              aria-current={selected ? 'true' : undefined}
            >
              <div className="performance-mode-icon">{card.icon}</div>
              <span className="eyebrow">{t(card.mode === 'default' ? 'WESTRON LAUNCHER' : card.mode === 'performance' ? 'FPS ODAKLI' : 'GÖRSEL KALİTE')}</span>
              <h2>{t(card.title)}</h2>
              <p>{t(card.description)}</p>
              {card.mode !== 'default' && (
                <label className={`performance-option ${unavailable ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={themeEnabled}
                    disabled={Boolean(busy)}
                    onChange={(event) => onThemeChange(event.currentTarget.checked)}
                  />
                  <span>{t('Temayı değiştir')}<small>{t('Seçili moda uygun renkleri kullan.')}</small></span>
                </label>
              )}
              {card.mode === 'quality' && (
                <label className={`performance-option ${unavailable || !shaderSupported ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={includeShader}
                    disabled={Boolean(busy) || unavailable || !shaderSupported}
                    onChange={(event) => onShaderChange(event.currentTarget.checked)}
                  />
                  <span>{t('Shader yükle')}<small>{t(shaderSupported
                    ? 'Varsayılan olarak kapalıdır; Iris ve Complementary Shaders kurulur.'
                    : 'Shader yalnızca Fabric profillerinde kullanılabilir.')}</small></span>
                </label>
              )}
              <button
                className={`button ${selected ? 'button-secondary' : 'button-primary'}`}
                disabled={Boolean(busy) || selected || gameRunning || unavailable}
                aria-pressed={selected}
                onClick={() => onSelect(card.mode)}
              >
                {cardBusy ? <LoaderCircle className="spin" size={15} /> : selected ? <Check size={15} /> : <Sparkles size={15} />}
                {cardBusy ? t('Yükleniyor…') : selected ? t('Aktif Mod') : t('Etkinleştir')}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

function HomePage({ state, microsoftAccount, microsoftBusy, offlineUsername, setOfflineUsername, busy, onInstall, onInstallMenu, onLaunchGame, onSignInMicrosoft, onCancelMicrosoftSignIn, onSignOutMicrosoft, onOpenSettings, onMods, onOpenFriends }: {
  state: LauncherState | null; microsoftAccount: MicrosoftAccount | null; microsoftBusy: boolean;
  offlineUsername: string; setOfflineUsername: (value: string) => void;
  busy: string; onInstall: () => void; onInstallMenu: () => void; onLaunchGame: () => void;
  onSignInMicrosoft: () => void; onCancelMicrosoftSignIn: () => void; onSignOutMicrosoft: () => void;
  onOpenSettings: () => void; onMods: () => void; onOpenFriends: () => void;
}) {
  const t = useUiText();
  const profileReady = Boolean(state?.loaderInstalled);
  const menuSupported = Boolean(state?.westronModSupported);
  const ready = profileReady && (!menuSupported || Boolean(state?.menuModInstalled));
  const primaryAction = !profileReady ? onInstall : menuSupported && !state?.menuModInstalled ? onInstallMenu : onLaunchGame;
  const primaryLabel = !profileReady
    ? `${state?.gameVersion ?? 'Minecraft'} ${state?.loader ?? 'fabric'} ${t('profilini kur')}`
    : menuSupported && !state?.menuModInstalled ? t('Oyun arayüzünü ekle') : t('Oyunu başlat');
  return (
    <>
      <PageHeading eyebrow={t('HOŞ GELDİN')} title={t('Oyunun, senin tarzın.')} description={`${t('Minecraft')} ${state?.gameVersion ?? ''} · ${t('Oyunun deneyimini tek yerden yönet; profilini kur, içeriklerini yönet ve kendi dünyanı kur.')}`} />

      <section className="hero-card">
        <div className="hero-grid" />
        <div className="hero-copy">
          <div className="hero-tag"><span className="online-dot" /> {t('STABLE RELEASE')} <span className="tag-divider">/</span> {state?.loader?.toUpperCase() ?? 'FABRIC'} {t('EDITION')}</div>
          <h2>{t('Biraz daha')}<br /><em>{t('sana ait.')}</em></h2>
          <p>{t('Temiz bir başlangıç. Sınırsız mod. Senin Minecraft’ın.')}</p>
          <div className="hero-actions">
            {microsoftAccount ? (
              <div className="microsoft-account-card">
                {microsoftAccount.skinUrl
                  ? <img className="microsoft-avatar" src={microsoftAccount.skinUrl} alt={`${microsoftAccount.username} Minecraft skin`} />
                  : <span className="microsoft-avatar microsoft-avatar-fallback">{microsoftAccount.username.slice(0, 1).toUpperCase()}</span>}
                <span className="microsoft-account-identity">
                  <strong>{microsoftAccount.username}</strong>
                  <small>Java Edition · {microsoftAccount.uuid}</small>
                </span>
                <button className="microsoft-signout" onClick={onSignOutMicrosoft} disabled={microsoftBusy} aria-label={t('Microsoft hesabından çıkış yap')} title={t('Microsoft hesabından çıkış yap')}>
                  {microsoftBusy ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}
                </button>
              </div>
            ) : (
              <>
                <label className="offline-username">
                  <span>{t('ÇEVRİMDIŞI KULLANICI ADI')}</span>
                  <input
                    value={offlineUsername}
                    onChange={(event) => setOfflineUsername(event.target.value)}
                    maxLength={16}
                    autoComplete="username"
                    spellCheck={false}
                    aria-label={t('Çevrimdışı kullanıcı adı')}
                  />
                </label>
                <div className="microsoft-login-group">
                  <button
                    className="button button-microsoft"
                    onClick={onSignInMicrosoft}
                    disabled={microsoftBusy || !state?.microsoftAuthConfigured}
                    title={state?.microsoftAuthConfigured ? t('Microsoft ile güvenli giriş') : t('Önce Microsoft Client ID yapılandırılmalı')}
                  >
                    {microsoftBusy ? <LoaderCircle className="spin" size={16} /> : <MicrosoftMark />}
                    {t('Microsoft ile Giriş Yap')}
                  </button>
                  {microsoftBusy && <button className="microsoft-cancel" onClick={onCancelMicrosoftSignIn}>{t('Girişi iptal et')}</button>}
                  {!state?.microsoftAuthConfigured && <small>{t('Microsoft Client ID ortam değişkeni ayarlanmalı')}</small>}
                </div>
              </>
            )}
            <button className="button button-primary button-large" onClick={primaryAction} disabled={Boolean(busy) || (!microsoftAccount && ready && !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername))}>
              {busy === 'fabric' || busy === 'launch' || busy === 'menu' ? <LoaderCircle className="spin" size={17} /> : ready ? <Play size={17} fill="currentColor" /> : <ArrowDownToLine size={17} />}
              {busy === 'launch' ? t('Oyun başlatılıyor…') : primaryLabel}
              <ArrowRight size={15} />
            </button>
            <button className="button button-ghost" onClick={onMods}><Sparkles size={16} />{t('Mod keşfet')}</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="cube cube-back" /><div className="cube cube-main"><div className="cube-face cube-top" /><div className="cube-face cube-left" /><div className="cube-face cube-right" /></div>
          <div className="art-ring ring-one" /><div className="art-ring ring-two" />
          <span className="art-coordinate">-128 / 72 / 304</span>
          <span className="art-label">OVERWORLD <b>01</b></span>
        </div>
        <div className="hero-bottom"><span><span className="online-dot" /> {t('STABLE RELEASE')}</span><span>{t('MINECRAFT')} <b>{state?.gameVersion ?? '26.3'}</b></span><span>{t('BUILT FOR YOUR WORLD')}</span></div>
      </section>

      <div className="section-title"><div><span className="eyebrow">{t('HIZLI ERİŞİM')}</span><h3>{t('Her şey yerli yerinde.')}</h3></div><button className="text-button" onClick={onOpenSettings}>{t('Tüm ayarlar')} <ArrowRight size={14} /></button></div>
      <div className="dashboard-grid">
        <div className="info-card">
          <div className="card-icon blue"><Box size={18} /></div><span className="card-kicker">{t('MOD KÜTÜPHANESİ')}</span>
          <div className="card-main"><strong>{state?.mods.length ?? 0} {t('mod yüklü')}</strong><span>{t('Uyumlu modları keşfet ve yönet.')}</span></div>
          <button className="round-arrow" onClick={onMods} aria-label={t('Modları keşfet')}><ArrowRight size={17} /></button>
        </div>
        <div className="info-card">
          <div className="card-icon green"><Users size={18} /></div><span className="card-kicker">{t('SOSYAL')}</span>
          <div className="card-main"><strong>{t('Arkadaşlar')}</strong><span>{t('Arkadaşlarınla sohbet et ve gruplarını yönet.')}</span></div>
          <button className="round-arrow" onClick={onOpenFriends} aria-label={t('Arkadaşları aç')}><ArrowRight size={17} /></button>
        </div>
      </div>

      <div className="status-row">
        <div className="status-item"><span className={`status-indicator ${state?.javaAvailable ? 'good' : 'warn'}`} /><span>JAVA RUNTIME</span><strong>{state?.javaAvailable ? t('Algılandı') : t('Bulunamadı')}</strong></div>
        <div className="status-separator" />
        <div className="status-item"><HardDrive size={15} /><span>{t('OYUN DİZİNİ')}</span><strong className="path-value" title={state?.minecraftDir}>{state?.minecraftDir ?? t('Yükleniyor…')}</strong></div>
      </div>
    </>
  );
}

function MicrosoftMark() {
  return (
    <svg className="microsoft-mark" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="#f25022" d="M1 1h8.5v8.5H1z" />
      <path fill="#7fba00" d="M10.5 1H19v8.5h-8.5z" />
      <path fill="#00a4ef" d="M1 10.5h8.5V19H1z" />
      <path fill="#ffb900" d="M10.5 10.5H19V19h-8.5z" />
    </svg>
  );
}

function ModsPage({ mods, totalHits, query, setQuery, busy, installedMods, installedProjectIds, onSearch, onLoadMore, onInstall, onRemove, onOpenFolder, loaderInstalled, loader, gameVersion, onInstallProfile }: {
  mods: ModrinthProject[]; totalHits: number; query: string; setQuery: (value: string) => void; busy: string;
  installedMods: LauncherState['mods']; installedProjectIds: string[]; onSearch: () => void; onInstall: (id: string, name: string) => void;
  onLoadMore: () => void;
  onRemove: (name: string) => void; onOpenFolder: () => void; loaderInstalled: boolean; loader: LauncherState['loader']; gameVersion: string; onInstallProfile: () => void;
}) {
  const t = useUiText();
  const language = useContext(AppLanguageContext);
  return (
    <>
      <PageHeading eyebrow={`MODRINTH • ${loader.toUpperCase()} ${gameVersion}`} title={t('Dünyanı genişlet.')} description={t('Seçili oyun sürümü ve yükleyicinle uyumlu modları keşfet, yükle ve yönet.')}>
        <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={16} />{t('Mod klasörü')}</button>
      </PageHeading>
      {loader === 'vanilla'
        ? <div className="inline-callout"><Layers3 size={17} /><span><strong>{t('Modlar için yükleyici gerekli.')}</strong> {t('Sol menüden Fabric veya Forge seç.')}</span></div>
        : !loaderInstalled && <div className="inline-callout"><Layers3 size={17} /><span><strong>{t('Önce oyun profili gerekli.')}</strong> Minecraft {gameVersion} {loader} {t('profilini kur.')}</span><button className="button button-primary button-small" onClick={onInstallProfile} disabled={Boolean(busy)}>{busy === 'profile' ? <LoaderCircle className="spin" size={14} /> : <ArrowDownToLine size={14} />}{loader} {t('kur')}</button></div>}
      <div className="mods-toolbar">
        <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder={t('Mod adı, ör. Sodium')} /><kbd>ENTER</kbd></div>
        <button className="button button-secondary search-button" onClick={onSearch} disabled={busy === 'search'}>{busy === 'search' ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{t('Ara')}</button>
      </div>
      <div className="results-heading"><div><span className="eyebrow">{t('ÖNE ÇIKANLAR')}</span><span className="result-count">{totalHits ? `${totalHits} ${t('sonuç')}` : t('Aramaya başla')}</span></div><span className="compatibility"><span className="online-dot" />{loader.toUpperCase()} {gameVersion} {t('UYUMLU')}</span></div>
      <div className="mod-grid">
        {mods.map((mod) => {
          const installed = installedProjectIds.includes(mod.id)
            || installedMods.some((item) => item.name.toLowerCase().includes(mod.slug.toLowerCase()));
          const isInstalling = busy === `mod:${mod.id}` || busy === `versions:${mod.id}`;
          return <article className="mod-card" key={mod.id}>
            <div className="mod-card-head">
              {mod.iconUrl ? <img className="mod-icon" src={mod.iconUrl} alt="" /> : <div className="mod-icon mod-icon-fallback"><Box size={20} /> </div>}
              <div className="mod-title"><h3>{mod.title}</h3><span>{formatDownloads(mod.downloads, language)} {t('indirme')}</span></div>
              <button className={`mod-action ${installed ? 'is-installed' : ''}`} title={installed ? t('Uyumlu sürüm seç') : t('Yükle')} disabled={Boolean(busy) || !loaderInstalled || loader === 'vanilla'} onClick={() => onInstall(mod.id, mod.title)}>
                {isInstalling ? <LoaderCircle className="spin" size={16} /> : installed ? <RefreshCw size={16} /> : <Plus size={16} />}
              </button>
            </div>
            <p>{mod.description}</p>
            <div className="mod-tags">{mod.categories.filter((category) => category !== loader).slice(0, 2).map((category) => <span key={category}>{category.replaceAll('-', ' ')}</span>)}<span className="loader-tag">{loader.toUpperCase()}</span></div>
          </article>;
        })}
      </div>
      {mods.length < totalHits && (
        <div className="load-more-results">
          <button className="button button-secondary" onClick={onLoadMore} disabled={Boolean(busy)}>
            {busy === 'search-more' ? <LoaderCircle className="spin" size={16} /> : <ChevronDown size={16} />}
            {t('Daha fazla öğe göster')}
          </button>
        </div>
      )}
      {!mods.length && <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>{t('Mod keşfine başla')}</strong><span>{t('Arama yap veya bekleyin; popüler modlar listelenecek.')}</span></div>}
      {installedMods.length > 0 && <section className="installed-section"><div className="section-title compact"><div><span className="eyebrow">{t('YÜKLÜ MODLAR')}</span><h3>{t('Kütüphanen')}</h3></div><span className="result-count">{installedMods.length} {t('dosya')}</span></div><ModList mods={installedMods} busy={busy} onRemove={onRemove} /></section>}
    </>
  );
}

function ModrinthPackPage({ type, projects, totalHits, query, setQuery, busy, installedFiles, installedProjectIds, gameVersion, loader, fabricInstalled, irisInstalled, onSearch, onLoadMore, onInstall, onRemove, onOpenFolder, onInstallFabric, onInstallIris }: {
  type: ContentType;
  projects: ModrinthProject[];
  totalHits: number;
  query: string;
  setQuery: (value: string) => void;
  busy: string;
  installedFiles: LauncherState['resourcePacks'];
  installedProjectIds: string[];
  gameVersion: string;
  loader: LauncherState['loader'];
  fabricInstalled: boolean;
  irisInstalled: boolean;
  onSearch: () => void;
  onLoadMore: () => void;
  onInstall: (id: string, title: string) => void;
  onRemove: (fileName: string) => void;
  onOpenFolder: () => void;
  onInstallFabric: () => void;
  onInstallIris: () => void;
}) {
  const t = useUiText();
  const language = useContext(AppLanguageContext);
  const isShader = type === 'shader';
  const label = t(isShader ? 'Shader paketleri' : 'Kaynak paketleri');
  const folder = isShader ? 'shaderpacks' : 'resourcepacks';
  const searchBusy = busy === `search:${type}`;
  return (
    <>
      <PageHeading
        eyebrow={`MODRINTH • ${loader.toUpperCase()} ${gameVersion}`}
        title={t(isShader ? 'Işığı değiştir.' : 'Dünyanı yeniden tasarla.')}
        description={isShader
          ? `${t('Minecraft ile uyumlu shader paketlerini keşfet ve tek tıkla yükle.')} ${gameVersion}`
          : `${t('Minecraft ile uyumlu kaynak paketlerini keşfet ve tek tıkla yükle.')} ${gameVersion}`}
      >
        <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={16} />{t('klasörü')} {folder}</button>
      </PageHeading>
      {isShader && loader !== 'fabric' && (
        <div className="inline-callout">
          <Layers3 size={17} />
          <span><strong>{t('Shader altyapısı Fabric gerektiriyor.')}</strong> {t('Iris için seçili loader Fabric olmalı.')}</span>
          <button className="button button-primary button-small" onClick={onInstallFabric} disabled={Boolean(busy)}>
            {busy === 'profile-options' ? <LoaderCircle className="spin" size={14} /> : <Layers3 size={14} />}{t('Fabric’e geç')}
          </button>
        </div>
      )}
      {isShader && loader === 'fabric' && !fabricInstalled && (
        <div className="inline-callout">
          <Layers3 size={17} />
          <span><strong>{t('Önce Fabric gerekli.')}</strong> {t('Shader paketlerini çalıştırmak için Minecraft')} {gameVersion} Fabric {t('profilini kur.')}</span>
          <button className="button button-primary button-small" onClick={onInstallFabric} disabled={Boolean(busy)}>
            {busy === 'profile' ? <LoaderCircle className="spin" size={14} /> : <ArrowDownToLine size={14} />}{t('Fabric’i kur')}
          </button>
        </div>
      )}
      {isShader && fabricInstalled && !irisInstalled && (
        <div className="inline-callout">
          <Sun size={17} />
          <span><strong>{t('Shader motoru gerekli.')}</strong> {t('Paketleri oyunda etkinleştirmek için Minecraft sürümüne uyumlu Iris kurulmalı.')}</span>
          <button className="button button-primary button-small" onClick={onInstallIris} disabled={Boolean(busy)}>
            {busy === `mod:${IRIS_PROJECT_ID}` ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}{t('Iris’i kur')}
          </button>
        </div>
      )}
      {isShader && fabricInstalled && irisInstalled && (
        <div className="inline-callout">
          <Check size={17} />
          <span><strong>{t('Iris hazır.')}</strong> {t('Kurduğun shader paketlerini oyunun video ayarlarından seçebilirsin.')}</span>
        </div>
      )}
      <div className="mods-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
            placeholder={t(isShader ? 'Shader adı, ör. Complementary' : 'Paket adı, ör. Faithful')}
          />
          <kbd>ENTER</kbd>
        </div>
        <button className="button button-secondary search-button" onClick={onSearch} disabled={searchBusy}>
          {searchBusy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{t('Ara')}
        </button>
      </div>
      <div className="results-heading">
        <div><span className="eyebrow">MINECRAFT {gameVersion} {t('UYUMLU')}</span><span className="result-count">{totalHits ? `${totalHits} ${t('sonuç')}` : t('Aramaya başla')}</span></div>
        <span className="compatibility"><span className="online-dot" />ZIP · MODRINTH</span>
      </div>
      <div className="mod-grid">
        {projects.map((project) => {
          const installed = installedProjectIds.includes(project.id) || installedFiles.some((item) =>
            item.name.toLowerCase().includes(project.slug.toLowerCase()));
          const isInstalling = busy === `content:${type}:${project.id}` || busy === `versions:${project.id}`;
          return (
            <article className="mod-card" key={project.id}>
              <div className="mod-card-head">
                {project.iconUrl
                  ? <img className="mod-icon" src={project.iconUrl} alt="" />
                  : <div className="mod-icon mod-icon-fallback">{isShader ? <Sun size={20} /> : <Image size={20} />}</div>}
                <div className="mod-title"><h3>{project.title}</h3><span>{formatDownloads(project.downloads, language)} {t('indirme')}</span></div>
                <button
                  className={`mod-action ${installed ? 'is-installed' : ''}`}
                  title={installed ? t('En yeni uyumlu sürümü yükle') : t('Yükle')}
                  aria-label={`${project.title} ${t(installed ? 'güncelle' : 'yükle')}`}
                  disabled={Boolean(busy)}
                  onClick={() => onInstall(project.id, project.title)}
                >
                  {isInstalling ? <LoaderCircle className="spin" size={16} /> : installed ? <RefreshCw size={16} /> : <Plus size={16} />}
                </button>
              </div>
              <p>{project.description}</p>
              <div className="mod-tags">
                {project.categories.slice(0, 2).map((category) => <span key={category}>{category.replaceAll('-', ' ')}</span>)}
                <span className="fabric-tag">{gameVersion} {t('UYUMLU')}</span>
              </div>
            </article>
          );
        })}
      </div>
      {projects.length < totalHits && (
        <div className="load-more-results">
          <button className="button button-secondary" onClick={onLoadMore} disabled={Boolean(busy)}>
            {busy === `search:${type}:more` ? <LoaderCircle className="spin" size={16} /> : <ChevronDown size={16} />}
            {t('Daha fazla öğe göster')}
          </button>
        </div>
      )}
      {!projects.length && (
        <div className="empty-state">
          <div className="empty-icon">{isShader ? <Sun size={22} /> : <Image size={22} />}</div>
          <strong>{label} {t('keşfine başla')}</strong>
          <span>{t('Arama yap veya popüler Modrinth paketlerini listelemek için bekle.')}</span>
        </div>
      )}
      {installedFiles.length > 0 && (
        <section className="installed-section">
          <div className="section-title compact">
            <div><span className="eyebrow">{t('YÜKLÜ PAKETLER')}</span><h3>{label}</h3></div>
            <span className="result-count">{installedFiles.length} {t('dosya')}</span>
          </div>
          <div className="mod-list">
            {installedFiles.map((file) => (
              <div className="mod-list-item" key={file.name}>
                <div className="list-mod-icon">{isShader ? <Sun size={16} /> : <Image size={16} />}</div>
                <div className="list-mod-name"><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
                <span className="list-mod-type">{t('ZIP PAKET')}</span>
                <button
                  className="remove-mod"
                  aria-label={`${file.name} paketini kaldır`}
                  disabled={Boolean(busy)}
                  onClick={() => onRemove(file.name)}
                >
                  {busy === `remove:${file.name}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function LibraryPage({ section, onSectionChange, children }: {
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  children: ReactNode;
}) {
  const t = useUiText();
  const sections: { id: LibrarySection; label: string; icon: React.ReactNode }[] = [
    { id: 'mods', label: t('Modlar'), icon: <Sparkles size={15} /> },
    { id: 'resourcepacks', label: t('Kaynak Paketleri'), icon: <Image size={15} /> },
    { id: 'shaders', label: t('Shader Paketleri'), icon: <Sun size={15} /> },
  ];
  return (
    <>
      <PageHeading eyebrow={t('OYUN DOSYALARI')} title={t('Kütüphanen.')} description={t('Yüklü modları, kaynak paketlerini ve shader paketlerini kaldır.')} />
      <nav className="library-sections" aria-label={t('Kütüphane bölümleri')}>
        {sections.map((item) => (
          <button
            type="button"
            className={`library-section-tab ${section === item.id ? 'selected' : ''}`}
            aria-current={section === item.id ? 'page' : undefined}
            key={item.id}
            onClick={() => onSectionChange(item.id)}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </nav>
      <div className="library-section-content">{children}</div>
    </>
  );
}

function InstalledLibrarySection({
  section,
  mods,
  resourcePacks,
  shaderPacks,
  projectMetadata,
  modMetadata,
  searchQuery,
  onSearchQueryChange,
  busy,
  onRemoveMod,
  onRemovePack,
  onInstallProject,
  onOpenFolder,
}: {
  section: LibrarySection;
  mods: LauncherState['mods'];
  resourcePacks: LauncherState['resourcePacks'];
  shaderPacks: LauncherState['shaderPacks'];
  projectMetadata: Record<string, ModrinthProjectMetadata>;
  modMetadata: Record<string, ModArchiveMetadata>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  busy: string;
  onRemoveMod: (fileName: string) => void;
  onRemovePack: (type: ContentType, fileName: string) => void;
  onInstallProject: (type: 'mod' | ContentType, projectId: string, title: string) => void;
  onOpenFolder: () => void;
}) {
  const t = useUiText();
  const isMods = section === 'mods';
  const isResources = section === 'resourcepacks';
  const items = isMods ? mods : isResources ? resourcePacks : shaderPacks;
  const title = isMods ? t('Yüklü modlar') : isResources ? t('Yüklü kaynak paketleri') : t('Yüklü shader paketleri');
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => {
      const itemTitle = item.projectId
        ? projectMetadata[item.projectId]?.title || item.name.replace(/\.(jar|zip)$/i, '')
        : item.name.replace(/\.(jar|zip)$/i, '');
      const description = (isMods ? modMetadata[item.name]?.description : undefined)
        || (item.projectId ? projectMetadata[item.projectId]?.description : '');
      return `${itemTitle} ${item.name} ${description}`.toLocaleLowerCase().includes(normalizedQuery);
    })
    : items;

  return (
    <section className="installed-library-panel">
      <div className="installed-library-heading">
        <div>
          <span className="eyebrow">{t('YÜKLÜ İÇERİK')}</span>
          <h2>{title}</h2>
          <p>{t('Bu bölümden yüklü dosyaları kaldırabilirsin.')}</p>
        </div>
        <button type="button" className="button button-secondary" onClick={onOpenFolder}>
          <FolderOpen size={15} />{t('Klasörü aç')}
        </button>
      </div>
      <label className="library-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={t('Kütüphanede ara')}
          aria-label={t('Kütüphanede ara')}
        />
      </label>
      {filteredItems.length > 0 ? (
        <div className="mod-list library-grid">
          {filteredItems.map((item) => (
            <article className="mod-list-item library-card" key={item.name}>
              <div className="library-card-heading">
                <div className="list-mod-icon">
                  {(isMods ? modMetadata[item.name]?.iconUrl : undefined) || (item.projectId ? projectMetadata[item.projectId]?.iconUrl : '')
                    ? <img src={(isMods ? modMetadata[item.name]?.iconUrl : undefined) || (item.projectId ? projectMetadata[item.projectId]?.iconUrl : '')} alt="" />
                    : isMods ? <Package size={16} /> : isResources ? <Image size={16} /> : <Sun size={16} />}
                </div>
                <div className="list-mod-name">
                  <strong>{item.projectId ? projectMetadata[item.projectId]?.title || item.name.replace(/\.(jar|zip)$/i, '') : item.name.replace(/\.(jar|zip)$/i, '')}</strong>
                  <span>{formatBytes(item.size)} · {isMods ? t('JAR MOD') : t('ZIP PAKET')}</span>
                </div>
                <span className={`list-mod-source ${item.projectId ? 'managed' : ''}`}>{item.projectId ? 'MODRINTH' : t('Yerel dosya')}</span>
              </div>
              <p className="library-card-description">
                {(isMods ? modMetadata[item.name]?.description : undefined)
                  || (item.projectId ? projectMetadata[item.projectId]?.description : '')
                  || t('Bu dosya seçili oyun profiline yüklenmiş.')}
              </p>
              <div className="library-card-details"><span>{item.name}</span></div>
              <div className="library-item-actions">
                <button
                  type="button"
                  className="button button-secondary library-reinstall-button"
                  aria-label={`${item.name} ${t('Yeniden yükle')}`}
                  title={item.projectId ? t('Yeniden yükle') : t('Modrinth üzerinden yüklenen içerik yeniden yüklenebilir.')}
                  disabled={Boolean(busy) || !item.projectId}
                  onClick={() => {
                    if (!item.projectId) return;
                    const contentType = isMods ? 'mod' : section === 'resourcepacks' ? 'resourcepack' : 'shader';
                    const title = projectMetadata[item.projectId]?.title || item.name.replace(/\.(jar|zip)$/i, '');
                    onInstallProject(contentType, item.projectId, title);
                  }}
                >
                  {busy === `versions:${item.projectId}` ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
                  {t('Yeniden yükle')}
                </button>
                <button
                  type="button"
                  className="button library-remove-button"
                  aria-label={`${item.name} ${t('dosyasını kaldır')}`}
                  title={t('Sil')}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (section === 'mods') onRemoveMod(item.name);
                    else onRemovePack(section === 'resourcepacks' ? 'resourcepack' : 'shader', item.name);
                  }}
                >
                  {busy === `remove:${item.name}` ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
                  {t('Sil')}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="empty-state installed-library-empty">
          <div className="empty-icon"><Search size={19} /></div>
          <strong>{t('Aramanızla eşleşen içerik bulunamadı.')}</strong>
        </div>
      ) : (
        <div className="empty-state installed-library-empty">
          <div className="empty-icon"><Trash2 size={19} /></div>
          <strong>{t('Yüklü içerik yok')}</strong>
          <span>{t('Bu kategoride kaldırılabilecek içerik bulunmuyor.')}</span>
        </div>
      )}
    </section>
  );
}

function ScreenshotsPage({ screenshots, status, busy, onRefresh, onDelete, onOpenFolder }: {
  screenshots: GameScreenshot[];
  status: 'loading' | 'ready' | 'error';
  busy: string;
  onRefresh: () => void;
  onDelete: (fileName: string) => void;
  onOpenFolder: () => void;
}) {
  const t = useUiText();
  const language = useContext(AppLanguageContext);
  const [selectedScreenshot, setSelectedScreenshot] = useState<GameScreenshot | null>(null);
  const [selectedScreenshotImage, setSelectedScreenshotImage] = useState('');
  const [loadingFullImage, setLoadingFullImage] = useState(false);
  const [fullImageError, setFullImageError] = useState(false);
  const [shareScreenshot, setShareScreenshot] = useState<GameScreenshot | null>(null);
  const [shareFriendIds, setShareFriendIds] = useState<string[]>([]);
  const [shareFriends, setShareFriends] = useState<WestronFriend[]>([]);
  const [shareGroupIds, setShareGroupIds] = useState<string[]>([]);
  const [shareGroups, setShareGroups] = useState<WestronFriendGroup[]>([]);
  const [shareTarget, setShareTarget] = useState<'friends' | 'groups'>('friends');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const shareSelectionCount = shareFriendIds.length + shareGroupIds.length;
  const [downloadScreenshotPrompt, setDownloadScreenshotPrompt] = useState<GameScreenshot | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [deleteScreenshotPrompt, setDeleteScreenshotPrompt] = useState<GameScreenshot | null>(null);

  async function openShare(screenshot: GameScreenshot) {
    setShareScreenshot(screenshot);
    setShareFriendIds([]);
    setShareGroupIds([]);
    setShareTarget('friends');
    setShareError('');
    setShareFriends([]);
    setShareGroups([]);
    try {
      const [friendsResult, groupsResult] = await Promise.allSettled([
        window.nocturne.listWestronFriends(),
        window.nocturne.listWestronGroups(),
      ]);
      if (friendsResult.status === 'rejected') throw friendsResult.reason;
      setShareFriends(friendsResult.value.friends);
      if (groupsResult.status === 'fulfilled') {
        setShareGroups(groupsResult.value);
      } else {
        setShareError(groupsResult.reason instanceof Error ? groupsResult.reason.message : String(groupsResult.reason));
      }
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function confirmShare() {
    if (!shareScreenshot || shareSelectionCount === 0) return;
    setShareBusy(true);
    setShareError('');
    try {
      const [friendsResult, groupsResult] = await Promise.allSettled([
        shareFriendIds.length
          ? window.nocturne.shareScreenshotToFriends({
            fileName: shareScreenshot.name,
            recipientUserIds: shareFriendIds,
          }).then(() => true)
          : Promise.resolve(false),
        shareGroupIds.length
          ? window.nocturne.shareScreenshotToGroups({
            fileName: shareScreenshot.name,
            groupIds: shareGroupIds,
          }).then(() => true)
          : Promise.resolve(false),
      ]);
      const friendsSucceeded = friendsResult.status === 'fulfilled';
      const groupsSucceeded = groupsResult.status === 'fulfilled';
      setShareFriendIds(friendsSucceeded ? [] : shareFriendIds);
      setShareGroupIds(groupsSucceeded ? [] : shareGroupIds);
      const shareErrors: string[] = [];
      if (friendsResult.status === 'rejected') {
        shareErrors.push(friendsResult.reason instanceof Error ? friendsResult.reason.message : String(friendsResult.reason));
      }
      if (groupsResult.status === 'rejected') {
        shareErrors.push(groupsResult.reason instanceof Error ? groupsResult.reason.message : String(groupsResult.reason));
      }
      if (friendsSucceeded || groupsSucceeded) await window.nocturne.playWestronNotification('message');
      if (shareErrors.length) {
        setShareError(shareErrors.join('\n'));
        return;
      }
      setShareScreenshot(null);
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setShareBusy(false);
    }
  }

  async function downloadScreenshot(screenshot: GameScreenshot) {
    setDownloadScreenshotPrompt(screenshot);
  }

  async function confirmDownloadScreenshot() {
    if (!downloadScreenshotPrompt) return;
    setDownloadBusy(true);
    try {
      await window.nocturne.downloadScreenshot(downloadScreenshotPrompt.name);
      setDownloadScreenshotPrompt(null);
    } catch {
      setDownloadScreenshotPrompt(null);
    } finally {
      setDownloadBusy(false);
    }
  }

  async function openScreenshot(screenshot: GameScreenshot) {
    setSelectedScreenshot(screenshot);
    setSelectedScreenshotImage('');
    setFullImageError(false);
    setLoadingFullImage(true);
    try {
      setSelectedScreenshotImage(await window.nocturne.readScreenshot(screenshot.name));
    } catch {
      setFullImageError(true);
    } finally {
      setLoadingFullImage(false);
    }
  }

  useEffect(() => {
    if (!selectedScreenshot) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedScreenshot(null);
        setSelectedScreenshotImage('');
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedScreenshot]);

  return (
    <>
      <PageHeading eyebrow={t('OYUN GALERİSİ')} title={t('Ekran Görüntüleri')} description={t('Minecraft içinde aldığın ekran görüntülerini görüntüle ve yönet.')}>
        <div className="page-heading-actions">
          <button className="button button-secondary" onClick={onRefresh} disabled={status === 'loading' || Boolean(busy)}>
            {status === 'loading' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
            {t('Yenile')}
          </button>
          <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={15} />{t('Dosya konumunu aç')}</button>
        </div>
      </PageHeading>
      {status === 'loading' && screenshots.length === 0 ? (
        <div className="empty-state screenshot-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} />
          <strong>{t('Ekran görüntüleri yükleniyor…')}</strong>
        </div>
      ) : status === 'error' && screenshots.length === 0 ? (
        <div className="empty-state screenshot-loading" role="status">
          <div className="empty-icon"><Camera size={22} /></div>
          <strong>{t('Ekran görüntüleri yüklenemedi.')}</strong>
          <button type="button" className="button button-secondary button-small" onClick={onRefresh}>{t('Yenile')}</button>
        </div>
      ) : screenshots.length ? (
        <>
        <div className="screenshot-grid">
          {screenshots.map((screenshot) => (
            <article className="screenshot-card" key={screenshot.name}>
              <button
                type="button"
                className="screenshot-preview-button"
                aria-label={`${screenshot.name} ${t('görüntüsünü büyüt')}`}
                onClick={() => { void openScreenshot(screenshot).catch(() => undefined); }}
              >
                <img src={screenshot.preview} alt={screenshot.name} loading="lazy" decoding="async" />
              </button>
              <div className="screenshot-card-info">
                <div><strong title={screenshot.name}>{screenshot.name}</strong><span>{new Intl.DateTimeFormat(languageLocales[language], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(screenshot.modifiedAt))} · {formatBytes(screenshot.size)}</span></div>
                <button className="remove-mod screenshot-share-action" aria-label={`${t('Paylaş')}: ${screenshot.name}`} title={t('Paylaş')} disabled={Boolean(busy)} onClick={() => void openShare(screenshot)}>
                  <Share2 size={15} />
                </button>
                <button className="remove-mod screenshot-download-action" aria-label={`${t('İndir')}: ${screenshot.name}`} title={t('İndir')} disabled={Boolean(busy)} onClick={() => void downloadScreenshot(screenshot)}>
                  <Download size={15} />
                </button>
                <button className="remove-mod" aria-label={`${screenshot.name} ${t('dosyasını kaldır')}`} title={t('Sil')} disabled={Boolean(busy)} onClick={() => setDeleteScreenshotPrompt(screenshot)}>
                  {busy === `screenshot:${screenshot.name}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                </button>
              </div>
            </article>
          ))}
        </div>
        </>
      ) : (
        <div className="empty-state"><div className="empty-icon"><Camera size={22} /></div><strong>{t('Henüz ekran görüntüsü yok.')}</strong><span>{t('Minecraft içinde F2 tuşuyla ekran görüntüsü al; burada görünecektir.')}</span></div>
      )}
      {selectedScreenshot && (
        <div
          className="screenshot-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedScreenshot(null);
              setSelectedScreenshotImage('');
            }
          }}
        >
          <section className="screenshot-modal" role="dialog" aria-modal="true" aria-label={selectedScreenshot.name}>
            <div className="screenshot-modal-heading">
              <strong title={selectedScreenshot.name}>{selectedScreenshot.name}</strong>
              <button type="button" className="icon-button" aria-label={t('Kapat')} onClick={() => { setSelectedScreenshot(null); setSelectedScreenshotImage(''); }}><X size={18} /></button>
            </div>
            <div className="screenshot-modal-viewer">
              <button type="button" className="screenshot-nav-arrow previous" aria-label={t('Önceki')} disabled={screenshots.findIndex((item) => item.name === selectedScreenshot.name) <= 0} onClick={() => {
                const index = screenshots.findIndex((item) => item.name === selectedScreenshot.name);
                if (index > 0) void openScreenshot(screenshots[index - 1]);
              }}><ChevronLeft size={20} /></button>
              {loadingFullImage
                ? <div className="screenshot-modal-loading"><LoaderCircle className="spin" size={22} />{t('Ekran görüntüsü yükleniyor…')}</div>
                : fullImageError
                  ? <div className="screenshot-modal-loading">{t('Ekran görüntüsü yüklenemedi.')}</div>
                  : selectedScreenshotImage && <img src={selectedScreenshotImage} alt={selectedScreenshot.name} />}
              <button type="button" className="screenshot-nav-arrow next" aria-label={t('Sonraki')} disabled={screenshots.findIndex((item) => item.name === selectedScreenshot.name) >= screenshots.length - 1} onClick={() => {
                const index = screenshots.findIndex((item) => item.name === selectedScreenshot.name);
                if (index >= 0 && index < screenshots.length - 1) void openScreenshot(screenshots[index + 1]);
              }}><ChevronRight size={20} /></button>
            </div>
          </section>
        </div>
      )}
      {deleteScreenshotPrompt && (
        <div className="dependency-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setDeleteScreenshotPrompt(null);
        }}>
          <section className="dependency-modal screenshot-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-screenshot-title">
            <div className="dependency-modal-icon"><Trash2 size={20} /></div>
            <h2 id="delete-screenshot-title">{t('Emin Misin?')}</h2>
            <p>{t('Bu ekran görüntüsü kalıcı olarak silinecek.')}</p>
            <strong className="screenshot-share-name">{deleteScreenshotPrompt.name}</strong>
            <div className="dependency-modal-actions">
              <button type="button" className="button button-ghost" onClick={() => setDeleteScreenshotPrompt(null)} disabled={Boolean(busy)}>{t('Vazgeç')}</button>
              <button type="button" className="button button-danger" onClick={() => {
                const fileName = deleteScreenshotPrompt.name;
                setDeleteScreenshotPrompt(null);
                onDelete(fileName);
              }} disabled={Boolean(busy)}>
                {busy === `screenshot:${deleteScreenshotPrompt.name}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                {t('Sil')}
              </button>
            </div>
          </section>
        </div>
      )}
      {downloadScreenshotPrompt && (
        <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDownloadScreenshotPrompt(null);
        }}>
          <section className="friends-confirm-modal screenshot-download-modal" role="dialog" aria-modal="true" aria-labelledby="download-screenshot-title">
            <div className="friends-confirm-icon"><Download size={20} /></div>
            <h2 id="download-screenshot-title">{t('Ekran görüntüsünü indir')}</h2>
            <p>{t('Bu ekran görüntüsü indirilenler klasörüne kaydedilecek.')}</p>
            <strong>{downloadScreenshotPrompt.name}</strong>
            <div className="friends-confirm-actions">
              <button type="button" className="button button-secondary" onClick={() => setDownloadScreenshotPrompt(null)}>{t('İptal')}</button>
              <button type="button" className="button button-primary screenshot-confirm-download" disabled={downloadBusy} onClick={() => void confirmDownloadScreenshot()}>
                {downloadBusy ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                {t('İndir')}
              </button>
            </div>
          </section>
        </div>
      )}
      {shareScreenshot && (
        <div className="dependency-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShareScreenshot(null);
        }}>
          <section className="dependency-modal screenshot-share-modal" role="dialog" aria-modal="true" aria-labelledby="share-screenshot-title">
            <div className="dependency-modal-heading"><div><span className="eyebrow">{t('EKRAN GÖRÜNTÜSÜ')}</span><h2 id="share-screenshot-title">{t('Ekran görüntüsü gönder')}</h2></div><button className="icon-button" type="button" onClick={() => setShareScreenshot(null)}><X size={17} /></button></div>
            <strong className="screenshot-share-name">{shareScreenshot.name}</strong>
            {shareError && <div className="toast toast-error" role="alert">{t(shareError)}</div>}
            <div className="screenshot-share-tabs" role="tablist" aria-label={t('Gönderilecek kişiler')}>
              <button className={shareTarget === 'friends' ? 'selected' : ''} type="button" role="tab" aria-selected={shareTarget === 'friends'} onClick={() => setShareTarget('friends')}>{t('Arkadaşlar')} ({shareFriendIds.length})</button>
              <button className={shareTarget === 'groups' ? 'selected' : ''} type="button" role="tab" aria-selected={shareTarget === 'groups'} onClick={() => setShareTarget('groups')}>{t('Gruplar')} ({shareGroupIds.length})</button>
            </div>
            <div className="screenshot-share-friends">
              {shareTarget === 'friends' && shareFriends.map((friend) => (
                <label key={friend.userId} className={shareFriendIds.includes(friend.userId) ? 'selected' : ''}>
                  <input type="checkbox" checked={shareFriendIds.includes(friend.userId)} onChange={(event) => setShareFriendIds((ids) => event.target.checked ? [...ids, friend.userId] : ids.filter((id) => id !== friend.userId))} />
                  <span className="avatar avatar-skin"><FriendSkinFace username={friend.username} /></span>
                  <span><strong>{friend.username}</strong><small>{friend.inGame ? t('Oyunda') : friend.online ? t('Çevrimiçi') : t('Çevrimdışı')}</small></span>
                </label>
              ))}
              {shareTarget === 'groups' && shareGroups.map((group) => (
                <label key={group.id} className={shareGroupIds.includes(group.id) ? 'selected' : ''}>
                  <input type="checkbox" checked={shareGroupIds.includes(group.id)} onChange={(event) => setShareGroupIds((ids) => event.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id))} />
                  <span className="screenshot-share-group-icon" aria-hidden="true">
                    {group.members.slice(0, 3).map((member, index) => (
                      <span className="screenshot-share-group-avatar" key={member.userId} style={{ zIndex: index + 1 }}>
                        <FriendSkinFace username={member.username} minecraftUsername={member.minecraftUsername} />
                      </span>
                    ))}
                    {group.members.length > 3 && <small>+{group.members.length - 3}</small>}
                  </span>
                  <span><strong>{group.name}</strong><small>{group.members.length} {t('üye')}</small></span>
                </label>
              ))}
              {shareTarget === 'friends' && shareFriends.length === 0 && <p>{t('Gönderilecek arkadaş bulunamadı.')}</p>}
              {shareTarget === 'groups' && shareGroups.length === 0 && <p>{t('Gönderilecek grup bulunamadı.')}</p>}
            </div>
            <div className="dependency-modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setShareScreenshot(null)}>{t('İptal')}</button>
              <button className="button button-primary" type="button" disabled={shareBusy || shareSelectionCount === 0} onClick={() => void confirmShare()}>
                {shareBusy ? <LoaderCircle className="spin" size={14} /> : <Share2 size={14} />}{t('Gönder')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ModList({ mods, busy, onRemove }: { mods: LauncherState['mods']; busy: string; onRemove: (name: string) => void }) {
  const t = useUiText();
  return <div className="mod-list">{mods.map((mod) => <div className="mod-list-item" key={mod.name}>
    <div className="list-mod-icon"><Package size={16} /></div><div className="list-mod-name"><strong>{mod.name}</strong><span>{formatBytes(mod.size)}</span></div>
    <span className="list-mod-type">{t('JAR MOD')}</span><button className="remove-mod" aria-label={`${mod.name} ${t('dosyasını kaldır')}`} disabled={Boolean(busy)} onClick={() => onRemove(mod.name)}>{busy === `remove:${mod.name}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button>
  </div>)}</div>;
}

function SettingsPage({
  state, language, onLanguageChange, theme, onThemeChange, busy, updateStatus, onCheckUpdates,
  gameBehavior, onGameBehaviorChange,
  onOpenProfilesFolder, onOpenSelectedProfileFolder, publisherAccount, publisherBusy, onPublishUpdate,
  performanceThemeChoice, onPerformanceThemeChoiceChange,
  profileAvatarShape, onProfileAvatarShapeChange, onOpenVoiceSettings,
}: {
  state: LauncherState | null;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  busy: string;
  updateStatus: UpdateStatus | null;
  onCheckUpdates: () => void;
  gameBehavior: GameBehavior;
  onGameBehaviorChange: (behavior: GameBehavior) => void;
  onOpenProfilesFolder: () => void;
  onOpenSelectedProfileFolder: () => void;
  publisherAccount: WestronAccount | null;
  publisherBusy: boolean;
  onPublishUpdate: () => void;
  performanceThemeChoice: 'default' | 'performance' | 'quality' | 'blue';
  onPerformanceThemeChoiceChange: (choice: 'default' | 'performance' | 'quality' | 'blue') => void;
  profileAvatarShape: 'round' | 'square';
  onProfileAvatarShapeChange: (shape: 'round' | 'square') => void;
  onOpenVoiceSettings: () => void;
}) {
  const t = (key: string) => translateUi(language, key);
  const ui = (value: string) => translateUi(language, value);
  return (
    <>
      <PageHeading eyebrow={t('preferences')} title={t('settings')} description={t('settingsDescription')} />
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon violet"><Languages size={18} /></div><div><h3>{t('language')}</h3><span>{t('chooseLanguage')}</span></div></div>
        <div className="setting-row">
          <div><strong>{t('displayLanguage')}</strong><span>{t('savedOnDevice')}</span></div>
          <label className="language-select-label">
            <span className="visually-hidden">{t('language')}</span>
            <select value={language} onChange={(event) => { if (isAppLanguage(event.target.value)) onLanguageChange(event.target.value); }} disabled={Boolean(busy)}>
              {SUPPORTED_LANGUAGES.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon violet"><Sun size={18} /></div><div><h3>{t('theme')}</h3><span>{t('themeDescription')}</span></div></div>
        <div className="setting-row">
          <div><strong>{t('theme')}</strong><span>{t('savedOnDevice')}</span></div>
          <label className="language-select-label">
            <span className="visually-hidden">{t('theme')}</span>
            <select value={theme} onChange={(event) => { if (event.target.value === 'dark' || event.target.value === 'light') onThemeChange(event.target.value); }} disabled={Boolean(busy)}>
              <option value="dark">{t('darkTheme')}</option>
              <option value="light">{t('lightTheme')}</option>
            </select>
          </label>
        </div>
        <div className="setting-row">
          <div><strong>{t('Westron Launcher Teması')}</strong><span>{t('Seçili temanın renk düzenini değiştirir.')}</span></div>
          <label className="language-select-label">
            <select value={performanceThemeChoice} onChange={(event) => {
              const choice = event.target.value;
              if (choice === 'default' || choice === 'performance' || choice === 'quality' || choice === 'blue') {
                onPerformanceThemeChoiceChange(choice);
              }
            }}>
              <option value="default">{t('Varsayılan tema')}</option>
              <option value="performance">{t('Yeşil Tema')}</option>
              <option value="quality">{t('Turuncu Tema')}</option>
              <option value="blue">{t('Mavi Tema')}</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon violet"><UserRound size={18} /></div><div><h3>{t('Profil fotoğrafları')}</h3><span>{t('Uygulama içindeki skin yüzlerinin görünümünü seç.')}</span></div></div>
        <div className="setting-row">
          <div><strong>{t('Profil fotoğrafı şekli')}</strong><span>{t('Arkadaşlar, hesap ve çağrı alanlarında kullanılır.')}</span></div>
          <label className="language-select-label">
            <select value={profileAvatarShape} onChange={(event) => onProfileAvatarShapeChange(event.target.value as 'round' | 'square')}>
              <option value="round">{t('Yuvarlak')}</option>
              <option value="square">{t('Kare')}</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon green"><Mic size={18} /></div><div><h3>{t('Ses Ayarları')}</h3><span>{t('Mikrofon, hoparlör ve oyun içi arayüz seçeneklerini ayarla.')}</span></div></div>
        <div className="setting-row">
          <div><strong>{t('Sesli sohbet')}</strong><span>{t('Sesli sohbet ayarlarına ve aktif arama görünümüne git.')}</span></div>
          <button
            className="button button-secondary button-small"
            type="button"
            aria-label={t('Ses Ayarları')}
            title={t('Ses Ayarları')}
            onClick={onOpenVoiceSettings}
          ><Mic size={14} />{t('Ses Ayarları')}</button>
        </div>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon violet"><Settings2 size={18} /></div><div><h3>{t('gameInstallation')}</h3><span>{t('gameInstallationDescription')}</span></div></div>
        <div className="setting-row"><div><strong>{t('minecraftFolder')}</strong><span>{t('profileModsLocation')}</span><code title={state?.minecraftDir}>{state?.minecraftDir ?? t('loading')}</code></div><button className="button button-secondary button-small" onClick={onOpenProfilesFolder} disabled={Boolean(busy)}><FolderOpen size={15} />{t('Westron Profiles klasörünü aç')}</button></div>
        <div className="setting-row">
          <div><strong>{t('selectedProfile')}</strong><span>{state?.gameDirectory}</span></div>
          <div className="library-heading-actions">
            <span className="setting-value">{state?.gameVersion ?? '…'} · {state?.loader ?? '…'}</span>
            <button className="button button-secondary button-small" onClick={onOpenSelectedProfileFolder} disabled={Boolean(busy)}>
              <FolderOpen size={15} />{t('Seçili profili aç')}
            </button>
          </div>
        </div>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon violet"><Play size={18} /></div><div><h3>{t('Westron Launcher davranışı')}</h3><span>{t('Westron Launcher’ın oyun açıldığında ve kapandığında nasıl davranacağını seç.')}</span></div></div>
        <div className="setting-row"><div><strong>{t('Oyun ve launcher davranışı')}</strong><span>{t('Westron Launcher’ın oyun açıldığında ve kapandığında nasıl davranacağını seç.')}</span></div><select value={gameBehavior} onChange={(event) => { if (['close-on-game-launch', 'stay-open', 'hide-and-restore'].includes(event.target.value)) onGameBehaviorChange(event.target.value as GameBehavior); }} disabled={Boolean(busy)}><option value="close-on-game-launch">{t('Oyun Açıldığında Westron Launcher Kapansın')}</option><option value="stay-open">{t('Westron Launcher her zaman açık kalsın')}</option><option value="hide-and-restore">{t('Westron Launcher Oyun Açılınca Gizlensin, Oyun Kapanınca Geri Açılsın')}</option></select></div>
      </section>
      <section className="settings-panel system-panel">
        <div className="settings-heading"><div className="card-icon blue"><Cpu size={18} /></div><div><h3>{t('systemStatus')}</h3><span>{t('requiredComponents')}</span></div></div>
        <div className="system-row"><span>Java runtime</span><strong className={state?.javaAvailable ? 'text-good' : 'text-warn'}>{state?.javaAvailable ? t('detected') : t('willInstall')}</strong><span className="system-path">{state?.javaAvailable || t('runtimeAutoPrepared')}</span></div>
        <div className="system-row"><span>{state?.loader ?? 'Loader'}</span><strong className={state?.loaderInstalled ? 'text-good' : ''}>{state?.loaderInstalled ? t('installed') : t('notInstalled')}</strong><span className="system-path">{t('profileInstallStatus')}</span></div>
        <div className="system-row"><span>Westron Launcher</span><strong className={state?.menuModInstalled ? 'text-good' : ''}>{state?.menuModInstalled ? t('installed') : state?.westronModSupported ? t('notInstalled') : t('unsupportedProfile')}</strong><span className="system-path">{t('supportedFabricOnly')}</span></div>
      </section>
      <section className="settings-panel update-settings">
        <div className="settings-heading"><div className="card-icon violet"><ArrowDownToLine size={18} /></div><div><h3>{t('updates')}</h3><span>{t('installedVersion')} {state?.displayVersion ?? '…'}</span></div></div>
        <div className="update-settings-row">
          <span>{updateStatus?.message ? translateUi(language, updateStatus.message) : t('updateAnytime')}</span>
          <button className="button button-secondary button-small" onClick={onCheckUpdates} disabled={updateStatus?.status === 'checking'}>
            {updateStatus?.status === 'checking' ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
            {t('checkForUpdates')}
          </button>
        </div>
      </section>
      {publisherAccount?.email.trim().toLowerCase() === 'ermiscaner78@gmail.com' && publisherAccount.emailVerified && (
        <section className="settings-panel update-publisher-panel">
          <div className="settings-heading"><div className="card-icon blue"><ArrowDownToLine size={18} /></div><div><h3>{t('Güncelleme yayımla')}</h3><span>{t('Yalnızca doğrulanmış yayıncı Westron hesabı kullanabilir.')}</span></div></div>
          <div className="update-settings-row"><span>{t('Derlenmiş release klasöründeki kurulum, blockmap ve latest.yml dosyalarını güvenli yayın servisine yükle.')}</span><button className="button button-secondary button-small" onClick={onPublishUpdate} disabled={publisherBusy}>{publisherBusy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}{publisherBusy ? t('Yayımlanıyor…') : t('Sürüm dosyalarını seç ve yayımla')}</button></div>
        </section>
      )}
      <div className="settings-note"><ShieldCheck size={17} /><span>{ui('Minecraft, giriş yöntemi olarak ana ekranda seçilen doğrulanmış Microsoft hesabını veya ayrı çevrimdışı kullanıcı adını kullanır. Westron Skin hesabı oyun oturumu sağlamaz.')}</span></div>
    </>
  );
}

function AppearancePage({
  account,
  profile,
  onProfileChange,
  onOpenAccount,
}: {
  account: WestronAccount | null;
  profile: WestronProfile | null;
  onProfileChange: (profile: WestronProfile | null) => void;
  onOpenAccount: () => void;
}) {
  const t = useUiText();
  return (
    <>
      <PageHeading eyebrow={t('KİŞİSELLEŞTİRME')} title={t('Skin & Pelerin.')} description={t('Westron hesabındaki görünümü yönet ve diğer oyuncularla paylaş.')} />
      {account
        ? <SkinAppearancePanel profile={profile} onProfileChange={onProfileChange} />
        : <section className="settings-panel account-appearance-required"><div className="settings-heading"><div className="card-icon violet"><UserRound size={18} /></div><div><h3>{t('Westron hesabı gerekli')}</h3><span>{t('Skin ve pelerinini yönetmek için Hesap menüsünden giriş yap.')}</span></div></div><button className="button button-primary button-small" onClick={onOpenAccount}><UserRound size={15} />{t('Hesaba git')}</button></section>}
    </>
  );
}

type PlayerAnimationName = 'idle' | 'walk' | 'run' | 'wave' | 'fly' | 'crouch' | 'swim';

function SkinModelPreview({ profile, language }: {
  profile: WestronProfile | null;
  language: AppLanguage;
}) {
  const t = (value: string) => translateUi(language, value);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<import('skinview3d').SkinViewer | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [animation, setAnimation] = useState<PlayerAnimationName>('walk');
  const [paused, setPaused] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showElytra, setShowElytra] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const hasSkin = Boolean(profile?.skin);

  useEffect(() => {
    let active = true;
    let resizeObserver: ResizeObserver | undefined;
    let viewer: import('skinview3d').SkinViewer | undefined;

    void import('skinview3d').then(({ SkinViewer, WalkingAnimation }) => {
      if (!active || !canvasRef.current) return;
      try {
        viewer = new SkinViewer({
          canvas: canvasRef.current,
          width: 420,
          height: 360,
          fov: 45,
          zoom: 0.82,
          background: 0x11141b,
          enableControls: true,
        });
        viewer.autoRotate = true;
        viewer.controls.enablePan = false;
        viewer.animation = new WalkingAnimation();
        viewerRef.current = viewer;
        const container = canvasRef.current.parentElement;
        if (container && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(([entry]) => {
            if (!entry || !viewer || viewer.disposed) return;
            viewer.setSize(
              Math.max(1, Math.floor(entry.contentRect.width)),
              Math.max(1, Math.floor(entry.contentRect.height)),
            );
          });
          resizeObserver.observe(container);
        }
        setViewerReady(true);
      } catch (reason) {
        setPreviewError(reason instanceof Error ? reason.message : String(reason));
      }
    }).catch((reason: unknown) => {
      if (active) setPreviewError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      active = false;
      resizeObserver?.disconnect();
      viewer?.dispose();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewerReady) return;
    let active = true;
    setPreviewError('');
    const skin = profile?.skin;
    const backTexture = showElytra ? profile?.elytra : profile?.cape;
    const cacheBust = (url: string, updatedAt: string) =>
      `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(updatedAt)}`;
    const loadTextures = async () => {
      try {
        if (skin) {
          await viewer.loadSkin(cacheBust(skin.url, skin.updatedAt), {
            model: skin.model === 'slim' ? 'slim' : 'default',
          });
        } else {
          viewer.loadSkin(null);
        }
        if (backTexture) {
          await viewer.loadCape(cacheBust(backTexture.url, backTexture.updatedAt), {
            backEquipment: showElytra ? 'elytra' : 'cape',
          });
        } else {
          viewer.loadCape(null);
        }
      } catch (reason) {
        if (active) {
          setPreviewError(`${translateUi(language, '3D önizleme görseli yüklenemedi. API görsellerinde CORS iznini kontrol edin.')}${reason instanceof Error ? ` (${reason.message})` : ''}`);
        }
      }
    };
    void loadTextures();
    return () => {
      active = false;
    };
  }, [
    profile?.skin?.url,
    profile?.skin?.updatedAt,
    profile?.skin?.model,
    profile?.cape?.url,
    profile?.cape?.updatedAt,
    profile?.elytra?.url,
    profile?.elytra?.updatedAt,
    showElytra,
    viewerReady,
    language,
  ]);

  useEffect(() => {
    let active = true;
    void import('skinview3d').then((skinview) => {
      if (!active || !viewerRef.current) return;
      const animations = {
        idle: () => new skinview.IdleAnimation(),
        walk: () => new skinview.WalkingAnimation(),
        run: () => new skinview.RunningAnimation(),
        wave: () => new skinview.WaveAnimation(),
        fly: () => new skinview.FlyingAnimation(),
        crouch: () => new skinview.CrouchAnimation(),
        swim: () => new skinview.SwimAnimation(),
      };
      const nextAnimation = animations[animation]();
      nextAnimation.speed = speed;
      nextAnimation.paused = paused;
      viewerRef.current.animation = nextAnimation;
      viewerRef.current.autoRotate = autoRotate;
    }).catch((reason: unknown) => {
      if (active) setPreviewError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [animation, paused, speed, autoRotate, viewerReady]);

  return (
    <section className="skin-3d-panel">
      <div className="skin-3d-heading">
        <div><strong>{t('3D karakter önizlemesi')}</strong><span>{t('Sürükleyerek döndür, kaydırarak yakınlaştır.')}</span></div>
        <button
          className={`button button-secondary button-small ${autoRotate ? 'selected' : ''}`}
          type="button"
          onClick={() => setAutoRotate((current) => !current)}
          disabled={!hasSkin}
        >
          <RotateCcw size={14} />{autoRotate ? t('Dönüş açık') : t('Dönüş kapalı')}
        </button>
      </div>
      <div className="skin-3d-stage">
        <canvas ref={canvasRef} aria-label={t('3D karakter önizlemesi')} />
        {!hasSkin && <div className="skin-3d-empty"><UserRound size={25} /><span>{t('Karakteri görmek için önce bir skin yükle.')}</span></div>}
        <label className="skin-3d-elytra-toggle">
          <input
            type="checkbox"
            checked={showElytra}
            onChange={(event) => setShowElytra(event.target.checked)}
            disabled={!hasSkin || !profile?.elytra}
          />
          <span>{t('3D önizlemede elitrayı göster')}</span>
        </label>
        {previewError && <div className="skin-3d-error" role="status">{t('3D önizleme görseli yüklenemedi. API görsellerinde CORS iznini kontrol edin.')}</div>}
      </div>
      <div className="skin-3d-controls">
        <label className="skin-3d-animation">
          <span>{t('Animasyon')}</span>
          <select value={animation} onChange={(event) => setAnimation(event.target.value as PlayerAnimationName)} disabled={!hasSkin}>
            <option value="idle">{t('Bekle')}</option>
            <option value="walk">{t('Yürü')}</option>
            <option value="run">{t('Koş')}</option>
            <option value="wave">{t('El salla')}</option>
            <option value="fly">{t('Uç')}</option>
            <option value="crouch">{t('Çömel')}</option>
            <option value="swim">{t('Yüz')}</option>
          </select>
        </label>
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={() => setPaused((current) => !current)}
          disabled={!hasSkin}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? t('Oynat') : t('Duraklat')}
        </button>
        <label className="skin-3d-speed">
          <span>{t('Hız')} <strong>{speed.toFixed(1)}×</strong></span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            disabled={!hasSkin}
          />
        </label>
      </div>
      {previewError && <p className="skin-3d-error-detail">{previewError}</p>}
    </section>
  );
}

function AccountPage({ account, profile, onAccountChange, onProfileChange }: {
  account: WestronAccount | null;
  profile: WestronProfile | null;
  onAccountChange: (account: WestronAccount | null) => void;
  onProfileChange: (profile: WestronProfile | null) => void;
}) {
  return (
    <WestronAccountPanel account={account} profile={profile} onAccountChange={onAccountChange} onProfileChange={onProfileChange} />
  );
}

function SkinFaceAvatar({ profile, size, fallback, onError }: {
  profile: WestronProfile | null;
  size: 'small' | 'large';
  fallback?: string;
  onError?: () => void;
}) {
  const skin = profile?.skin;
  const [failed, setFailed] = useState(false);
  const [legacySkin, setLegacySkin] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLegacySkin(false);
  }, [skin?.url, skin?.updatedAt]);
  if (!skin || failed) return <span className={`skin-face-fallback skin-face-fallback-${size}`}>{fallback ?? 'W'}</span>;
  const skinImageUrl = `${skin.url}${skin.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(skin.updatedAt)}`;
  const handleImageError = () => {
    setFailed(true);
    onError?.();
  };
  const handleOverlayError = (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.display = 'none';
  };
  return (
    <span className={`skin-face-texture skin-face-texture-${size}`} data-skin-format={legacySkin ? 'legacy' : 'modern'} aria-label={profile.username}>
      <img className="skin-face-base" src={skinImageUrl} alt="" onLoad={(event) => setLegacySkin(event.currentTarget.naturalHeight * 2 === event.currentTarget.naturalWidth)} onError={handleImageError} />
      <img className="skin-face-overlay" src={skinImageUrl} alt="" onLoad={(event) => setLegacySkin(event.currentTarget.naturalHeight * 2 === event.currentTarget.naturalWidth)} onError={handleOverlayError} />
    </span>
  );
}

function SkinAppearancePanel({ profile, onProfileChange }: {
  profile: WestronProfile | null;
  onProfileChange: (profile: WestronProfile | null) => void;
}) {
  const language = useContext(AppLanguageContext);
  const t = (value: string) => translateUi(language, value);
  const [skinModel, setSkinModel] = useState<'classic' | 'slim'>('classic');
  const [busy, setBusy] = useState(false);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<'skin' | 'cape' | 'elytra' | null>(null);

  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      const rawMessage = reason instanceof Error ? reason.message : String(reason);
      setError(t(rawMessage));
    } finally {
      setBusy(false);
    }
  }

  async function uploadSkin() {
    await perform(async () => {
      const upload = await window.nocturne.uploadWestronSkin(skinModel);
      if (upload.cancelled) return;
      onProfileChange(upload.profile ?? null);
      setMessage(t('Skin Westron hesabınıza yüklendi.'));
    });
  }

  async function uploadCape() {
    await perform(async () => {
      const upload = await window.nocturne.uploadWestronCape();
      if (upload.cancelled) return;
      onProfileChange(upload.profile ?? null);
      setMessage(t('Pelerin Westron hesabınıza yüklendi.'));
    });
  }

  async function uploadElytra() {
    await perform(async () => {
      const upload = await window.nocturne.uploadWestronElytra();
      if (upload.cancelled) return;
      onProfileChange(upload.profile ?? null);
      setMessage(t('Elitra Westron hesabınıza yüklendi.'));
    });
  }

  async function refreshProfile() {
    setProfileRefreshing(true);
    setError('');
    try {
      onProfileChange(await window.nocturne.getWestronProfile());
      setMessage(t('Westron skin profili güncellendi.'));
    } catch (reason) {
      setError(t(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setProfileRefreshing(false);
    }
  }

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    await perform(async () => {
      const next = pendingRemoval === 'skin'
        ? await window.nocturne.deleteWestronSkin()
        : pendingRemoval === 'cape'
          ? await window.nocturne.deleteWestronCape()
          : await window.nocturne.deleteWestronElytra();
      onProfileChange(next);
      setMessage(t(pendingRemoval === 'skin'
        ? 'Skin kaldırıldı.'
        : pendingRemoval === 'cape' ? 'Pelerin kaldırıldı.' : 'Elitra kaldırıldı.'));
      setPendingRemoval(null);
    });
  }

  return (
    <section className="settings-panel skin-appearance-panel">
      <div className="settings-heading"><div className="card-icon violet"><Image size={18} /></div><div><h3>{t('Skin ve pelerin')}</h3><span>{t('Skin ve pelerinini Westron hesabına yükle.')}</span></div></div>
      <SkinModelPreview profile={profile} language={language} />
      <div className="setting-row">
        <div className="skin-profile-summary">
          {profile?.skin ? <img className="skin-preview" src={`${profile.skin.url}${profile.skin.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(profile.skin.updatedAt)}`} alt={t('Westron hesabındaki mevcut skin')} /> : <span className="skin-preview skin-preview-empty"><UserRound size={17} /></span>}
          <span><strong>{t('Westron skin profili')}</strong><small>{profile?.skin ? `${profile.skin.model} ${t('modeli')} · ${new Date(profile.skin.updatedAt).toLocaleDateString(languageLocales[language])}` : t('Henüz skin yüklenmedi. PNG dosyanı yükleyebilirsin.')}</small></span>
        </div>
        <div className="account-actions">
          <select aria-label={t('Skin modeli')} value={skinModel} onChange={(event) => setSkinModel(event.target.value as 'classic' | 'slim')}><option value="classic">Classic</option><option value="slim">Slim</option></select>
          <button className="button button-secondary button-small" onClick={() => void refreshProfile()} disabled={busy || profileRefreshing}>{profileRefreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{t('Yenile')}</button>
          <button className="button button-secondary button-small" onClick={() => void uploadSkin()} disabled={busy}><Upload size={14} />{t('PNG skin yükle')}</button>
          {profile?.skin && <button className="button button-secondary button-small" onClick={() => setPendingRemoval('skin')} disabled={busy}><Trash2 size={14} />{t("Skin'i kaldır")}</button>}
        </div>
      </div>
      <div className="setting-row">
        <div className="skin-profile-summary">
          {profile?.cape ? <img className="cape-preview" src={`${profile.cape.url}${profile.cape.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(profile.cape.updatedAt)}`} alt={t('Westron hesabındaki mevcut pelerin')} /> : <span className="cape-preview cape-preview-empty"><Image size={17} /></span>}
          <span><strong>{t('Westron pelerini')}</strong><small>{profile?.cape ? `${t('Güncelleme')}: ${new Date(profile.cape.updatedAt).toLocaleDateString(languageLocales[language])}` : t('Henüz pelerin yüklenmedi. 64×32 PNG dosyası seç.')}</small></span>
        </div>
        <div className="account-actions">
          <button className="button button-secondary button-small" onClick={() => void refreshProfile()} disabled={busy || profileRefreshing}>{profileRefreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{t('Yenile')}</button>
          <button className="button button-secondary button-small" onClick={() => void uploadCape()} disabled={busy}><Upload size={14} />{t('PNG pelerin yükle')}</button>
          {profile?.cape && <button className="button button-secondary button-small" onClick={() => setPendingRemoval('cape')} disabled={busy}><Trash2 size={14} />{t('Pelerini kaldır')}</button>}
        </div>
      </div>
      <div className="setting-row">
        <div className="skin-profile-summary">
          {profile?.elytra ? <img className="cape-preview" src={`${profile.elytra.url}${profile.elytra.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(profile.elytra.updatedAt)}`} alt={t('Westron hesabındaki mevcut elitra')} /> : <span className="cape-preview cape-preview-empty"><Image size={17} /></span>}
          <span><strong>{t('Westron elitrası')}</strong><small>{profile?.elytra ? `${t('Güncelleme')}: ${new Date(profile.elytra.updatedAt).toLocaleDateString(languageLocales[language])}` : t('Henüz elitra yüklenmedi. 64×32 PNG dosyası seç.')}</small></span>
        </div>
        <div className="account-actions">
          <button className="button button-secondary button-small" onClick={() => void uploadElytra()} disabled={busy}><Upload size={14} />{t('PNG elitra yükle')}</button>
          {profile?.elytra && <button className="button button-secondary button-small" onClick={() => setPendingRemoval('elytra')} disabled={busy}><Trash2 size={14} />{t('Elitrayı kaldır')}</button>}
        </div>
      </div>
      {error && <div className="account-message account-error">{error}</div>}
      {message && <div className="account-message">{message}</div>}
      {pendingRemoval && <AppearanceRemovalModal appearanceType={pendingRemoval} busy={busy} onCancel={() => setPendingRemoval(null)} onConfirm={() => void confirmRemoval()} />}
    </section>
  );
}

function WestronAccountPanel({
  account,
  profile,
  onAccountChange,
  onProfileChange,
}: {
  account: WestronAccount | null;
  profile: WestronProfile | null;
  onAccountChange: (account: WestronAccount | null) => void;
  onProfileChange: (profile: WestronProfile | null) => void;
}) {
  const language = useContext(AppLanguageContext);
  const t = (value: string) => translateUi(language, value);
  const [form, setForm] = useState<'login' | 'register' | 'verify' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingLogout, setPendingLogout] = useState(false);

  function handleAccountError(reason: unknown, fallbackEmail?: string) {
    const rawMessage = reason instanceof Error ? reason.message : String(reason);
    if (rawMessage.startsWith('Westron oturumunuz sona erdi.')) {
      setEmail(fallbackEmail ?? account?.email ?? email);
      onAccountChange(null);
      onProfileChange(null);
      setForm('login');
    }
    if (rawMessage.includes('404') || rawMessage.includes('Error:')) setError('');
    else setError(t(rawMessage));
  }

  async function performAccountAction(action: () => Promise<string | WestronAccount | void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (typeof result === 'string') setMessage(t(result));
      return result;
    } catch (reason) {
      handleAccountError(reason);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    const result = await performAccountAction(() => window.nocturne.loginWestronAccount({ email, password }));
    setPassword('');
    if (result && typeof result !== 'string') {
      onAccountChange(result);
      setForm('login');
      await window.nocturne.getWestronProfile().then(onProfileChange).catch((reason: unknown) => {
        handleAccountError(reason);
      });
    }
  }

  async function submitRegistration(event: React.FormEvent) {
    event.preventDefault();
    const result = await performAccountAction(() =>
      window.nocturne.registerWestronAccount({ username, email, password }));
    setPassword('');
    if (typeof result === 'string') setForm('verify');
  }

  async function submitVerification(event: React.FormEvent) {
    event.preventDefault();
    const result = await performAccountAction(() => window.nocturne.verifyWestronEmail({ email, token }));
    if (typeof result === 'string') {
      setToken('');
      setForm('login');
    }
  }

  async function submitPasswordReset(event: React.FormEvent) {
    event.preventDefault();
    const result = await performAccountAction(() =>
      window.nocturne.resetPassword({ email, token, newPassword }));
    setNewPassword('');
    if (typeof result === 'string') {
      setToken('');
      setForm('login');
    }
  }

  async function logout() {
    setPendingLogout(true);
  }

  async function confirmLogout() {
    await performAccountAction(async () => {
      const result = await window.nocturne.logoutWestronAccount();
      onAccountChange(null);
      onProfileChange(null);
      setPendingLogout(false);
      return result;
    });
  }

  return (
    <>
    <section className="settings-panel account-page-panel">
      <div className="settings-heading">
        <div className="card-icon violet"><UserRound size={18} /></div>
        <div><h3>{t('Westron hesabı')}</h3><span>{t('Westron hesap bilgilerini ve giriş ayarlarını yönet.')}</span></div>
      </div>
      {account ? (
        <div className="account-overview">
          <div className="account-overview-profile">
            <div className="account-overview-avatar">
              <SkinFaceAvatar profile={profile} size="large" fallback={account.username.slice(0, 1).toUpperCase()} />
            </div>
            <div className="account-overview-identity">
              <span className="eyebrow">{t('HESAP ÖZETİ')}</span>
              <strong>{account.username}</strong>
              <span>{account.email}</span>
            </div>
            <span className={`account-verification ${account.emailVerified ? 'verified' : ''}`}>
              <Check size={14} />{account.emailVerified ? t('E-posta doğrulandı') : t('Doğrulanmadı')}
            </span>
          </div>
          <div className="account-overview-footer">
            <div className="account-security-card">
              <div className="card-icon green"><ShieldCheck size={17} /></div>
              <div><strong>{account.emailVerified ? t('Hesabın doğrulandı') : t('E-posta doğrulaması gerekli')}</strong><span>{t('Hesap bilgilerin ve doğrulama durumun burada.')}</span></div>
            </div>
            <button className="button button-secondary" onClick={() => void logout()} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}{t('Çıkış yap')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="account-tabs">
            <button className={form === 'login' ? 'selected' : ''} onClick={() => setForm('login')}>{t('Giriş yap')}</button>
            <button className={form === 'register' ? 'selected' : ''} onClick={() => setForm('register')}>{t('Hesap oluştur')}</button>
          </div>
          {form === 'login' && (
            <form className="account-form" onSubmit={(event) => void submitLogin(event)}>
              <label>{t('E-posta')}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>{t('Parola')}<input type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <div className="account-form-actions">
                <button className="button button-primary button-small" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null}{t('Giriş yap')}</button>
                <button type="button" className="text-button" onClick={() => setForm('reset')}>{t('Parolamı unuttum')}</button>
                <button type="button" className="text-button" onClick={() => setForm('verify')}>{t('E-postayı doğrula')}</button>
              </div>
            </form>
          )}
          {form === 'register' && (
            <form className="account-form" onSubmit={(event) => void submitRegistration(event)}>
              <label>{t('Kullanıcı adı')}<input autoComplete="username" required minLength={3} maxLength={16} pattern="[A-Za-z0-9_]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
              <label>{t('E-posta')}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>{t('Parola')}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <div className="account-form-actions">
                <button className="button button-primary button-small" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null}{t('Hesap oluştur')}</button>
                <button type="button" className="text-button" onClick={() => setForm('verify')}>{t('Doğrulama kodum var')}</button>
              </div>
            </form>
          )}
          {form === 'verify' && (
            <form className="account-form" onSubmit={(event) => void submitVerification(event)}>
              <p>{t('E-postanıza gelen tek kullanımlık kodu girin.')}</p>
              <label>{t('E-posta')}<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>{t('Doğrulama kodu')}<input required minLength={6} maxLength={6} inputMode="numeric" pattern="[0-9]{6}" value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
              <div className="account-form-actions">
                <button className="button button-primary button-small" disabled={busy}>{t('E-postayı doğrula')}</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => void performAccountAction(() => window.nocturne.resendWestronVerification({ email }))}>{t('Kodu yeniden gönder')}</button>
              </div>
            </form>
          )}
          {form === 'reset' && (
            <form className="account-form" onSubmit={(event) => void submitPasswordReset(event)}>
              <p>{t('Sıfırlama kodu almak için hesabınızın e-posta adresini girin.')}</p>
              <label>{t('E-posta')}<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void performAccountAction(() => window.nocturne.requestPasswordReset({ email }))}>{t('Sıfırlama kodu iste')}</button>
              <label>{t('Sıfırlama kodu')}<input required minLength={40} maxLength={50} value={token} onChange={(event) => setToken(event.target.value)} /></label>
              <label>{t('Yeni parola')}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <button className="button button-primary button-small" disabled={busy}>{t('Parolayı yenile')}</button>
            </form>
          )}
        </>
      )}
      {error && <div className="account-message account-error">{error}</div>}
      {message && <div className="account-message">{message}</div>}
    </section>
    {pendingLogout && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPendingLogout(false);
      }}>
        <section className="friends-confirm-modal" role="dialog" aria-modal="true">
          <div className="friends-confirm-icon"><LogOut size={20} /></div>
          <h2>{t('Çıkış yapmak istiyor musunuz?')}</h2>
          <p>{t('Westron hesabınız bu cihazdan kapatılacak.')}</p>
          <div className="friends-confirm-actions">
            <button type="button" className="button button-secondary" onClick={() => setPendingLogout(false)}>{t('İptal')}</button>
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void confirmLogout()}>{t('Çıkış yap')}</button>
          </div>
        </section>
      </div>
    )}
    </>
  );
}

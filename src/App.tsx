import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isAppLanguage, SUPPORTED_LANGUAGES, translate, translateUi, type AppLanguage } from './i18n';
import {
  ArrowDownToLine, ArrowRight, Box, Check, ChevronDown, CircleHelp, Compass, Image,
  Cpu, FolderOpen, HardDrive, Layers3, LoaderCircle,
  Languages, LogOut, Package, Pause, Play, Plus, RefreshCw, RotateCcw, Search,
  Settings2, ShieldCheck, Sparkles, Sun, Trash2, Upload, UserRound, X,
} from 'lucide-react';

type ContentType = 'resourcepack' | 'shader';
type Page = 'home' | 'mods' | 'resourcepacks' | 'shaders' | 'library' | 'appearance' | 'settings';
const IRIS_PROJECT_ID = 'YL57xq9U';
const AppLanguageContext = createContext<AppLanguage>('tr');

function useUiText() {
  const language = useContext(AppLanguageContext);
  return (text: string) => translateUi(language, text);
}

const pageLabels: Record<Page, string> = {
  home: 'Genel Bakış',
  mods: 'Mod keşfet',
  resourcepacks: 'Kaynak paketleri',
  shaders: 'Shader paketleri',
  library: 'Kütüphane',
  appearance: 'Skin & Pelerin',
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
  const [setupLanguage, setSetupLanguage] = useState<AppLanguage>('tr');
  const [offlineUsername, setOfflineUsername] = useState('Player');
  const [mods, setMods] = useState<ModrinthProject[]>([]);
  const [packProjects, setPackProjects] = useState<ModrinthProject[]>([]);
  const [gameVersions, setGameVersions] = useState<MinecraftVersionOption[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [notice, setNotice] = useState('');
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
    dependencies: ModDependency[];
  } | null>(null);
  const [removalPrompt, setRemovalPrompt] = useState<{
    name: string; size: number; type: 'mod' | ContentType;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [microsoftAccount, setMicrosoftAccount] = useState<MicrosoftAccount | null>(null);
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [westronAccount, setWestronAccount] = useState<WestronAccount | null>(null);
  const [westronProfile, setWestronProfile] = useState<WestronProfile | null>(null);
  const [skinAvatarFailed, setSkinAvatarFailed] = useState(false);
  const text = (value: string) => translateUi(state?.language ?? 'tr', value);
  const installPercent = Math.max(0, Math.min(100, Math.round(installProgress?.overallPercent ?? 0)));
  const pageTitle = text(pageLabels[page]);

  useEffect(() => {
    document.documentElement.lang = state?.language ?? 'tr';
  }, [state?.language]);

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
    }).catch(reportError);
    void window.nocturne.getGameVersions().then(setGameVersions).catch(reportError);
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
    setError(reason instanceof Error ? reason.message : String(reason));
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

  async function search() {
    setBusy('search');
    setError('');
    try {
      setMods(await window.nocturne.searchMods(query.trim()));
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
      setPackProjects(await window.nocturne.searchContent(type, searchQuery));
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy('');
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
      setMods([]);
      setPackProjects([]);
      setQuery('');
      setNotice(`Minecraft ${gameVersion} ${loader} profili seçildi.`);
      return true;
    } catch (reason) {
      reportError(reason);
      return false;
    } finally {
      setBusy('');
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
    setBusy('language');
    setError('');
    try {
      setState(await window.nocturne.saveLanguage(language));
      setNotice(`${translate(language, 'language')}: ${SUPPORTED_LANGUAGES.find((item) => item.code === language)?.label ?? language}`);
      setLanguageSetupRequired(false);
      return true;
    } catch (reason) {
      reportError(reason);
      return false;
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (page !== 'mods' || mods.length > 0 || !state || state.loader === 'vanilla') return;
    void Promise.resolve().then(() => window.nocturne.searchMods('')).then(setMods).catch(reportError);
  }, [page, mods.length, state?.gameVersion, state?.loader]);

  useEffect(() => {
    if (page === 'resourcepacks') {
      setQuery('');
      void searchPacks('resourcepack', '');
    }
    if (page === 'shaders') {
      setQuery('');
      void searchPacks('shader', '');
    }
  }, [page, state?.gameVersion]);

  useEffect(() => {
    if (!dependencyPrompt && !removalPrompt && !profilePrompt) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setDependencyPrompt(null);
        setRemovalPrompt(null);
        setProfilePrompt(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dependencyPrompt, removalPrompt, profilePrompt, busy]);

  async function installMod(
    projectId: string,
    modName: string,
    confirmedDependencyIds?: string[],
  ) {
    const result = await perform(
      `mod:${projectId}`,
      () => window.nocturne.installMod(projectId, confirmedDependencyIds),
      (installResult) => {
        if (installResult.status === 'confirmation-required') return '';
        if (!installResult.files.length) return `${modName} zaten yüklü.`;
        return installResult.dependencies.length > 0
          ? `${modName} ve ${installResult.dependencies.length} gerekli mod eklendi.`
          : `${modName} eklendi.`;
      },
    );
    if (!result) return;
    if (result.status === 'confirmation-required') {
      setDependencyPrompt({ projectId, modName, dependencies: result.dependencies });
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

  async function installPack(type: ContentType, projectId: string, title: string) {
    setBusy(`content:${type}:${projectId}`);
    setError('');
    setNotice('');
    try {
      const result = await window.nocturne.installContent(type, projectId);
      await refresh();
      setNotice(result.status === 'already-installed'
        ? `${title} (${result.versionNumber}) zaten güncel.`
        : `${title} ${result.versionNumber} sürümü yüklendi.`);
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
      reportError(reason);
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

  const installedCount = state?.mods.length ?? 0;

  return (
    <AppLanguageContext.Provider value={state?.language ?? 'tr'}>
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('home'); }}>
          <span className="brand-mark"><Layers3 size={19} strokeWidth={1.8} /></span>
          <span className="brand-name">Westron<span>.</span><small>CLIENT</small></span>
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
          <small>{text('Her sürüm ayrı oyun klasörü kullanır.')}</small>
        </section>

        <div className="nav-label">{text('MENÜ')}</div>
        <nav className="nav-list">
          <NavButton icon={<Compass />} label={text('Genel Bakış')} active={page === 'home'} onClick={() => setPage('home')} />
          <NavButton icon={<Sparkles />} label={text('Mod keşfet')} active={page === 'mods'} onClick={() => setPage('mods')} badge="MODRINTH" />
          <NavButton icon={<Image />} label={text('Kaynak paketleri')} active={page === 'resourcepacks'} onClick={() => setPage('resourcepacks')} />
          <NavButton icon={<Sun />} label={text('Shader paketleri')} active={page === 'shaders'} onClick={() => setPage('shaders')} />
          <NavButton icon={<Package />} label={text('Kütüphane')} active={page === 'library'} onClick={() => setPage('library')} count={installedCount} />
          <NavButton icon={<UserRound />} label={text('Skin & Pelerin')} active={page === 'appearance'} onClick={() => setPage('appearance')} />
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-card">
          <span className="online-dot" />
          <div><strong>{state?.loaderInstalled ? `${state.loader.toUpperCase()} ${text('READY')}` : text('PROFILE READY')}</strong><small>Minecraft {state?.gameVersion ?? '…'}</small></div>
          <ShieldCheck size={16} className="sidebar-shield" />
        </div>
        <NavButton icon={<Settings2 />} label={text('Ayarlar')} active={page === 'settings'} onClick={() => setPage('settings')} />
        <div className="sidebar-foot">WESTRON CLIENT <span>•</span> v{state?.displayVersion ?? '…'}</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>WESTRON CLIENT</span><ChevronDown size={13} /><strong>{pageTitle}</strong></div>
          <div className="topbar-right">
            <span className="top-version"><span className="online-dot" />{state?.menuModInstalled ? text('Westron Client hazır') : state?.loaderInstalled ? `${state.loader} ${text('kurulu')}` : `${text('Sürüm')} ${state?.gameVersion ?? '…'}`}</span>
            <button className="icon-button" aria-label={text('Yardım')} onClick={() => setNotice(text('Profil kurulumu ve içerik yönetimi için sol menüyü kullanın.'))}><CircleHelp size={17} /></button>
            {westronProfile?.skin && !skinAvatarFailed ? (
              <span className="avatar avatar-skin" aria-label={westronProfile.username}>
                <img
                  className="avatar-face"
                  src={`${westronProfile.skin.url}${westronProfile.skin.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(westronProfile.skin.updatedAt)}`}
                  alt=""
                  onError={() => setSkinAvatarFailed(true)}
                />
                <img
                  className="avatar-face-overlay"
                  src={`${westronProfile.skin.url}${westronProfile.skin.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(westronProfile.skin.updatedAt)}`}
                  alt=""
                  onError={() => setSkinAvatarFailed(true)}
                />
              </span>
            ) : <div className="avatar">W</div>}
          </div>
        </header>

        <div className="content">
          {error && <div className="toast toast-error"><X size={16} />{translateUi(state?.language ?? 'tr', error)}<button onClick={() => setError('')} aria-label={text('Kapat')}><X size={15} /></button></div>}
          {notice && <div className="toast toast-success"><Check size={16} />{translateUi(state?.language ?? 'tr', notice)}<button onClick={() => setNotice('')} aria-label={text('Kapat')}><X size={15} /></button></div>}
          {updateStatus && ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'publishing', 'error'].includes(updateStatus.status) && (
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
              onInstallMenu={() => perform('menu', () => window.nocturne.installMenu(), (message) => message || 'Westron Client arayüzü kuruldu.')}
              onLaunchGame={() => perform('launch', () => window.nocturne.launchGame(microsoftAccount
                ? { mode: 'microsoft' }
                : { mode: 'offline', offlineUsername }), (message) => message || 'Minecraft başlatıldı.')}
              onSignInMicrosoft={() => { void signInMicrosoft(); }}
              onCancelMicrosoftSignIn={() => { void cancelMicrosoftSignIn(); }}
              onSignOutMicrosoft={() => { void signOutMicrosoft(); }}
              onOpenSettings={() => setPage('settings')}
              onMods={() => setPage('mods')}
            />
          )}
          {page === 'mods' && (
            <ModsPage
              mods={mods}
              query={query}
              setQuery={setQuery}
              busy={busy}
              installedMods={state?.mods ?? []}
              installedProjectIds={state?.modrinthModProjects ?? []}
              onSearch={search}
              onInstall={(id, name) => { void installMod(id, name); }}
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
              query={query}
              setQuery={setQuery}
              busy={busy}
              installedFiles={page === 'resourcepacks' ? state?.resourcePacks ?? [] : state?.shaderPacks ?? []}
              installedProjectIds={page === 'resourcepacks' ? state?.resourcePackProjects ?? [] : state?.shaderProjects ?? []}
              onSearch={() => { void searchPacks(page === 'resourcepacks' ? 'resourcepack' : 'shader'); }}
              onInstall={(id, title) => { void installPack(page === 'resourcepacks' ? 'resourcepack' : 'shader', id, title); }}
              onRemove={(fileName) => requestPackRemoval(page === 'resourcepacks' ? 'resourcepack' : 'shader', fileName)}
              onOpenFolder={() => perform('folder', () => window.nocturne.openContentFolder(page === 'resourcepacks' ? 'resourcepack' : 'shader'))}
              gameVersion={state?.gameVersion ?? ''}
              loader={state?.loader ?? 'fabric'}
              fabricInstalled={Boolean(state?.fabricInstalled)}
              irisInstalled={Boolean(state?.modrinthModProjects.includes(IRIS_PROJECT_ID))}
              onInstallFabric={() => { void ensureFabricProfile(); }}
              onInstallIris={() => { void installMod(IRIS_PROJECT_ID, 'Iris shader altyapısı'); }}
            />
          )}
          {page === 'library' && (
            <LibraryPage
              state={state}
              busy={busy}
              onRemove={requestModRemoval}
              onOpenFolder={() => perform('folder', () => window.nocturne.openModsFolder())}
              onMods={() => setPage('mods')}
            />
          )}
          {page === 'appearance' && (
            <AppearancePage
              account={westronAccount}
              profile={westronProfile}
              onAccountChange={setWestronAccount}
              onProfileChange={setWestronProfile}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              state={state}
              language={state?.language ?? 'tr'}
              onLanguageChange={(language: LauncherState['language']) => { void saveLanguage(language); }}
              onChooseFolder={() => perform('folder', () => window.nocturne.chooseMinecraftDir())}
              busy={busy}
              updateStatus={updateStatus}
              onCheckUpdates={() => { void checkForUpdates(); }}
            />
          )}
        </div>
      </main>
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
          language={state?.language ?? 'tr'}
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
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
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
        {status.status === 'checking' || downloading || status.status === 'publishing'
          ? <LoaderCircle className="spin" size={19} />
          : status.status === 'downloaded' || status.status === 'up-to-date' ? <Check size={19} /> : <ArrowDownToLine size={19} />}
      </div>
      <div className="update-banner-copy">
        <div className="update-banner-heading">
          <strong>{status.status === 'available' ? `Westron Client ${status.version} ${t('hazır')}` : status.status === 'downloaded' ? t('Güncelleme kuruluma hazır') : status.status === 'up-to-date' ? t('Yeni güncelleme yok') : status.status === 'error' ? t('Güncelleme tamamlanamadı') : status.status === 'publishing' ? t('Güncelleme yayımlanıyor') : t('Westron Client güncelleniyor')}</strong>
          <span>{t('Şu anki sürüm')} {status.currentVersion}</span>
        </div>
        <p>{status.message}</p>
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
        {(status.status === 'checking' || status.status === 'publishing') && <span className="update-checking">{status.status === 'publishing' ? `%${status.percent ?? 0}` : t('Kontrol ediliyor')}</span>}
      </div>
    </section>
  );
}

function UpdatePublisherPanel() {
  const t = useUiText();
  const [account, setAccount] = useState<WestronAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.nocturne) {
      setError(t('Launcher bağlantısı yüklenemedi. Uygulamayı yeniden başlatın.'));
      return;
    }
    void window.nocturne.getWestronAccount().then(setAccount).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);
  if (account?.email.trim().toLowerCase() !== 'ermiscaner78@gmail.com') return null;

  async function publish() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await window.nocturne.publishUpdate();
      if (!result.cancelled) setMessage(result.message || t('Güncelleme yayımlandı.'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel update-publisher-panel">
      <div className="settings-heading"><div className="card-icon blue"><Upload size={18} /></div><div><h3>{t('Güncelleme yayımla')}</h3><span>{t('Yalnızca Westron güncelleme yayıncısı kullanabilir.')}</span></div></div>
      <div className="update-settings-row">
        <span>{t('klasörünü seçin; Setup,')} <code>release</code>, <code>.blockmap</code> {t('ve')} <code>latest.yml</code> {t('birlikte yayımlanır.')}</span>
        <button className="button button-secondary button-small" onClick={() => { void publish(); }} disabled={busy || !account.emailVerified}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
          {account.emailVerified ? t('Release dosyalarını seç') : t('Önce e-postayı doğrulayın')}
        </button>
      </div>
      {message && <p className="publisher-message">{message}</p>}
      {error && <p className="publisher-error">{error}</p>}
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
            {t('Evet, modu kaldır')}
          </button>
        </div>
      </section>
    </div>
  );
}

function AppearanceRemovalModal({ appearanceType, busy, onCancel, onConfirm }: {
  appearanceType: 'skin' | 'cape';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useUiText();
  const isSkin = appearanceType === 'skin';
  const title = isSkin
    ? t("Skin'in silinecek. Emin misin?")
    : t('Pelerinin silinecek. Emin misin?');
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

function HomePage({ state, microsoftAccount, microsoftBusy, offlineUsername, setOfflineUsername, busy, onInstall, onInstallMenu, onLaunchGame, onSignInMicrosoft, onCancelMicrosoftSignIn, onSignOutMicrosoft, onOpenSettings, onMods }: {
  state: LauncherState | null; microsoftAccount: MicrosoftAccount | null; microsoftBusy: boolean;
  offlineUsername: string; setOfflineUsername: (value: string) => void;
  busy: string; onInstall: () => void; onInstallMenu: () => void; onLaunchGame: () => void;
  onSignInMicrosoft: () => void; onCancelMicrosoftSignIn: () => void; onSignOutMicrosoft: () => void;
  onOpenSettings: () => void; onMods: () => void;
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
        <div className="info-card install-card">
          <div className="card-icon violet"><Layers3 size={18} /></div><span className="card-kicker">{t('OYUN PROFİLİ')}</span>
          <div className="card-main"><strong>{ready ? t('Oyun profili hazır') : profileReady ? t('Oyun arayüzünü ekle') : `${state?.loader ?? 'fabric'} ${t('profilini kur')}`}</strong><span>{ready ? `Minecraft ${state?.gameVersion} ${t('profili kullanıma hazır.')}` : profileReady ? t('Uyumlu Westron Client oyun arayüzünü kur.') : `${t('Minecraft için oyun dosyalarını hazırla:')} ${state?.gameVersion ?? ''}`}</span></div>
          <button className="round-arrow" onClick={primaryAction} disabled={Boolean(busy)} aria-label={primaryLabel}><ArrowRight size={17} /></button>
        </div>
        <div className="info-card">
          <div className="card-icon blue"><Box size={18} /></div><span className="card-kicker">{t('MOD KÜTÜPHANESİ')}</span>
          <div className="card-main"><strong>{state?.mods.length ?? 0} {t('mod yüklü')}</strong><span>{t('Uyumlu modları keşfet ve yönet.')}</span></div>
          <button className="round-arrow" onClick={onMods} aria-label={t('Modları keşfet')}><ArrowRight size={17} /></button>
        </div>
      </div>

      <div className="status-row">
        <div className="status-item"><span className={`status-indicator ${state?.javaAvailable ? 'good' : 'warn'}`} /><span>JAVA RUNTIME</span><strong>{state?.javaAvailable ? t('Algılandı') : t('Bulunamadı')}</strong></div>
        <div className="status-separator" />
        <div className="status-item"><HardDrive size={15} /><span>{t('OYUN DİZİNİ')}</span><strong className="path-value" title={state?.minecraftDir}>{state?.minecraftDir ?? t('Yükleniyor…')}</strong></div>
        <button className="status-change" onClick={onOpenSettings}>{t('Değiştir')} <ArrowRight size={13} /></button>
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

function ModsPage({ mods, query, setQuery, busy, installedMods, installedProjectIds, onSearch, onInstall, onRemove, onOpenFolder, loaderInstalled, loader, gameVersion, onInstallProfile }: {
  mods: ModrinthProject[]; query: string; setQuery: (value: string) => void; busy: string;
  installedMods: LauncherState['mods']; installedProjectIds: string[]; onSearch: () => void; onInstall: (id: string, name: string) => void;
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
      <div className="results-heading"><div><span className="eyebrow">{t('ÖNE ÇIKANLAR')}</span><span className="result-count">{mods.length ? `${mods.length} ${t('sonuç')}` : t('Aramaya başla')}</span></div><span className="compatibility"><span className="online-dot" />{loader.toUpperCase()} {gameVersion} {t('UYUMLU')}</span></div>
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
            <div className="mod-tags">{mod.categories.slice(0, 2).map((category) => <span key={category}>{category.replaceAll('-', ' ')}</span>)}<span className="fabric-tag">FABRIC</span></div>
          </article>;
        })}
      </div>
      {!mods.length && <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>{t('Mod keşfine başla')}</strong><span>{t('Arama yap veya bekleyin; popüler modlar listelenecek.')}</span></div>}
      {installedMods.length > 0 && <section className="installed-section"><div className="section-title compact"><div><span className="eyebrow">{t('YÜKLÜ MODLAR')}</span><h3>{t('Kütüphanen')}</h3></div><span className="result-count">{installedMods.length} {t('dosya')}</span></div><ModList mods={installedMods} busy={busy} onRemove={onRemove} /></section>}
    </>
  );
}

function ModrinthPackPage({ type, projects, query, setQuery, busy, installedFiles, installedProjectIds, gameVersion, loader, fabricInstalled, irisInstalled, onSearch, onInstall, onRemove, onOpenFolder, onInstallFabric, onInstallIris }: {
  type: ContentType;
  projects: ModrinthProject[];
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
        eyebrow={`MODRINTH • MINECRAFT ${gameVersion}`}
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
        <div><span className="eyebrow">MINECRAFT {gameVersion} {t('UYUMLU')}</span><span className="result-count">{projects.length ? `${projects.length} ${t('sonuç')}` : t('Aramaya başla')}</span></div>
        <span className="compatibility"><span className="online-dot" />ZIP · MODRINTH</span>
      </div>
      <div className="mod-grid">
        {projects.map((project) => {
          const installed = installedProjectIds.includes(project.id) || installedFiles.some((item) =>
            item.name.toLowerCase().includes(project.slug.toLowerCase()));
          const isInstalling = busy === `content:${type}:${project.id}`;
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

function LibraryPage({ state, busy, onRemove, onOpenFolder, onMods }: {
  state: LauncherState | null; busy: string; onRemove: (name: string) => void; onOpenFolder: () => void; onMods: () => void;
}) {
  const t = useUiText();
  return (
    <>
      <PageHeading eyebrow={t('OYUN DOSYALARI')} title={t('Kütüphanen.')} description={t('Yüklü modlarını yönet, dosya konumuna git ve koleksiyonunu büyüt.')}>
        <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={16} />{t('Klasörü aç')}</button>
      </PageHeading>
      <div className="library-summary">
        <div className="library-stat"><div className="card-icon violet"><Package size={19} /></div><div><strong>{state?.mods.length ?? 0}</strong><span>{t('YÜKLÜ MOD')}</span></div></div>
        <div className="library-stat"><div className="card-icon blue"><Layers3 size={19} /></div><div><strong>{state?.fabricInstalled ? t('Hazır') : t('Kurulmadı')}</strong><span>{t('FABRIC PROFİLİ')}</span></div></div>
        <div className="library-stat"><div className="card-icon green"><Cpu size={19} /></div><div><strong>{state?.gameVersion ?? '26.3'}</strong><span>{t('MINECRAFT SÜRÜMÜ')}</span></div></div>
      </div>
      {state?.mods.length ? <div className="library-panel"><div className="panel-heading"><div><h3>{t('Mod dosyaları')}</h3><span>{t('Minecraft mods klasöründeki JAR dosyaları')}</span></div><button className="button button-secondary button-small" onClick={onMods}><Sparkles size={14} />{t('Mod keşfet')}</button></div><ModList mods={state.mods} busy={busy} onRemove={onRemove} /></div> :
        <div className="empty-state library-empty"><div className="empty-icon"><Package size={22} /></div><strong>{t('Kütüphanen henüz boş.')}</strong><span>{t('Modrinth kataloğundan sevdiğin modları eklemeye başla.')}</span><button className="button button-primary button-small" onClick={onMods}><Sparkles size={14} />{t('Mod keşfet')}</button></div>}
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

function SettingsPage({ state, language, onLanguageChange, onChooseFolder, busy, updateStatus, onCheckUpdates }: {
  state: LauncherState | null; language: AppLanguage; onLanguageChange: (language: AppLanguage) => void; onChooseFolder: () => void; busy: string;
  updateStatus: UpdateStatus | null; onCheckUpdates: () => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
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
        <div className="settings-heading"><div className="card-icon violet"><Settings2 size={18} /></div><div><h3>{t('gameInstallation')}</h3><span>{t('gameInstallationDescription')}</span></div></div>
        <div className="setting-row"><div><strong>{t('minecraftFolder')}</strong><span>{t('profileModsLocation')}</span><code title={state?.minecraftDir}>{state?.minecraftDir ?? t('loading')}</code></div><button className="button button-secondary button-small" onClick={onChooseFolder} disabled={Boolean(busy)}><FolderOpen size={15} />{t('chooseFolder')}</button></div>
        <div className="setting-row"><div><strong>{t('selectedProfile')}</strong><span>{state?.gameDirectory}</span></div><span className="setting-value">{state?.gameVersion ?? '…'} · {state?.loader ?? '…'}</span></div>
      </section>
      <section className="settings-panel system-panel">
        <div className="settings-heading"><div className="card-icon blue"><Cpu size={18} /></div><div><h3>{t('systemStatus')}</h3><span>{t('requiredComponents')}</span></div></div>
        <div className="system-row"><span>Java runtime</span><strong className={state?.javaAvailable ? 'text-good' : 'text-warn'}>{state?.javaAvailable ? t('detected') : t('willInstall')}</strong><span className="system-path">{state?.javaAvailable || t('runtimeAutoPrepared')}</span></div>
        <div className="system-row"><span>{state?.loader ?? 'Loader'}</span><strong className={state?.loaderInstalled ? 'text-good' : ''}>{state?.loaderInstalled ? t('installed') : t('notInstalled')}</strong><span className="system-path">{t('profileInstallStatus')}</span></div>
        <div className="system-row"><span>Westron Client</span><strong className={state?.menuModInstalled ? 'text-good' : ''}>{state?.menuModInstalled ? t('installed') : state?.westronModSupported ? t('notInstalled') : t('unsupportedProfile')}</strong><span className="system-path">{t('supportedFabricOnly')}</span></div>
      </section>
      <section className="settings-panel update-settings">
        <div className="settings-heading"><div className="card-icon violet"><ArrowDownToLine size={18} /></div><div><h3>{t('updates')}</h3><span>{t('installedVersion')} {state?.displayVersion ?? '…'} · {t('updatesHttps')}</span></div></div>
        <div className="update-settings-row">
          <span>{updateStatus?.message ? translateUi(language, updateStatus.message) : t('updateAnytime')}</span>
          <button className="button button-secondary button-small" onClick={onCheckUpdates} disabled={updateStatus?.status === 'checking'}>
            {updateStatus?.status === 'checking' ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
            {t('checkForUpdates')}
          </button>
        </div>
      </section>
      <UpdatePublisherPanel />
      <div className="settings-note"><ShieldCheck size={17} /><span>{ui('Minecraft, giriş yöntemi olarak ana ekranda seçilen doğrulanmış Microsoft hesabını veya ayrı çevrimdışı kullanıcı adını kullanır. Westron Skin hesabı oyun oturumu sağlamaz.')}</span></div>
    </>
  );
}

function AppearancePage({
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
  const t = useUiText();
  return (
    <>
      <PageHeading eyebrow={t('KİŞİSELLEŞTİRME')} title={t('Skin & Pelerin.')} description={t('Westron hesabındaki görünümü yönet ve diğer oyuncularla paylaş.')} />
      <WestronAccountPanel
        account={account}
        profile={profile}
        onAccountChange={onAccountChange}
        onProfileChange={onProfileChange}
      />
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
    const cape = profile?.cape;
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
        if (cape) {
          await viewer.loadCape(cacheBust(cape.url, cape.updatedAt));
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
  }, [profile?.skin?.url, profile?.skin?.updatedAt, profile?.skin?.model, profile?.cape?.url, profile?.cape?.updatedAt, viewerReady, language]);

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
  const [skinModel, setSkinModel] = useState<'classic' | 'slim'>('classic');
  const [busy, setBusy] = useState(false);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingAppearanceRemoval, setPendingAppearanceRemoval] = useState<'skin' | 'cape' | null>(null);

  function handleAccountError(reason: unknown, fallbackEmail?: string) {
    const rawMessage = reason instanceof Error ? reason.message : String(reason);
    if (rawMessage.startsWith('Westron oturumunuz sona erdi.')) {
      setEmail(fallbackEmail ?? account?.email ?? email);
      onAccountChange(null);
      onProfileChange(null);
      setForm('login');
    }
    setError(t(rawMessage));
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
      window.nocturne.resetWestronPassword({ email, token, newPassword }));
    setNewPassword('');
    if (typeof result === 'string') {
      setToken('');
      setForm('login');
    }
  }

  async function uploadSkin() {
    const result = await performAccountAction(async () => {
      const upload = await window.nocturne.uploadWestronSkin(skinModel);
      if (upload.cancelled) return t('Skin seçimi iptal edildi.');
      onProfileChange(upload.profile ?? null);
      return t('Skin Westron hesabınıza yüklendi.');
    });
    void result;
  }

  async function uploadCape() {
    const result = await performAccountAction(async () => {
      const upload = await window.nocturne.uploadWestronCape();
      if (upload.cancelled) return t('Pelerin seçimi iptal edildi.');
      onProfileChange(upload.profile ?? null);
      return t('Pelerin Westron hesabınıza yüklendi.');
    });
    void result;
  }

  async function confirmAppearanceRemoval() {
    if (!pendingAppearanceRemoval) return;
    const removingSkin = pendingAppearanceRemoval === 'skin';
    await performAccountAction(async () => {
      const nextProfile = removingSkin
        ? await window.nocturne.deleteWestronSkin()
        : await window.nocturne.deleteWestronCape();
      onProfileChange(nextProfile);
      return t(removingSkin ? 'Skin kaldırıldı.' : 'Pelerin kaldırıldı.');
    });
    setPendingAppearanceRemoval(null);
  }

  async function refreshSkinProfile() {
    setProfileRefreshing(true);
    setError('');
    try {
      onProfileChange(await window.nocturne.getWestronProfile());
      setMessage(t('Westron skin profili güncellendi.'));
    } catch (reason) {
      handleAccountError(reason);
    } finally {
      setProfileRefreshing(false);
    }
  }

  async function logout() {
    await performAccountAction(async () => {
      const result = await window.nocturne.logoutWestronAccount();
      onAccountChange(null);
      onProfileChange(null);
      return result;
    });
  }

  return (
    <section className="settings-panel">
      <div className="settings-heading">
        <div className="card-icon violet"><UserRound size={18} /></div>
        <div><h3>{t('Westron hesabı ve görünüm')}</h3><span>{t('Skin ve pelerinini Westron hesabına yükle.')}</span></div>
      </div>
      {account ? (
        <>
          <SkinModelPreview profile={profile} language={language} />
          <div className="setting-row">
            <div><strong>{account.username}</strong><span>{account.email} · {account.emailVerified ? t('E-posta doğrulandı') : t('Doğrulanmadı')}</span></div>
            <button className="button button-secondary button-small" onClick={() => void logout()} disabled={busy}><LogOut size={14} />{t('Çıkış yap')}</button>
          </div>
          <div className="setting-row">
            <div className="skin-profile-summary">
              {profile?.skin
                ? <img className="skin-preview" src={`${profile.skin.url}${profile.skin.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(profile.skin.updatedAt)}`} alt={t('Westron hesabındaki mevcut skin')} />
                : <span className="skin-preview skin-preview-empty"><UserRound size={17} /></span>}
              <span><strong>{t('Westron skin profili')}</strong><small>{profile?.skin ? `${profile.skin.model} ${t('modeli')} · ${new Date(profile.skin.updatedAt).toLocaleDateString(language === 'en' ? 'en-US' : `${language}-${language.toUpperCase()}`)}` : t('Henüz skin yüklenmedi. PNG dosyanı yükleyebilirsin.')}</small></span>
            </div>
            <div className="account-actions">
              <select aria-label={t('Skin modeli')} value={skinModel} onChange={(event) => setSkinModel(event.target.value as 'classic' | 'slim')}>
                <option value="classic">Classic</option>
                <option value="slim">Slim</option>
              </select>
              <button className="button button-secondary button-small" onClick={() => void refreshSkinProfile()} disabled={busy || profileRefreshing}>
                {profileRefreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                {t('Yenile')}
              </button>
              <button className="button button-secondary button-small" onClick={() => void uploadSkin()} disabled={busy}><Upload size={14} />{t('PNG skin yükle')}</button>
              {profile?.skin && <button className="button button-secondary button-small" onClick={() => setPendingAppearanceRemoval('skin')} disabled={busy}><Trash2 size={14} />{t("Skin'i kaldır")}</button>}
            </div>
          </div>
          <div className="setting-row">
            <div className="skin-profile-summary">
              {profile?.cape
                ? <img className="cape-preview" src={`${profile.cape.url}${profile.cape.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(profile.cape.updatedAt)}`} alt={t('Westron hesabındaki mevcut pelerin')} />
                : <span className="cape-preview cape-preview-empty"><Image size={17} /></span>}
              <span><strong>{t('Westron pelerini')}</strong><small>{profile?.cape ? `${t('Güncelleme')}: ${new Date(profile.cape.updatedAt).toLocaleDateString(language === 'en' ? 'en-US' : `${language}-${language.toUpperCase()}`)}` : t('Henüz pelerin yüklenmedi. 64×32 PNG dosyası seç.')}</small></span>
            </div>
            <div className="account-actions">
              <button className="button button-secondary button-small" onClick={() => void refreshSkinProfile()} disabled={busy || profileRefreshing}>
                {profileRefreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                {t('Yenile')}
              </button>
              <button className="button button-secondary button-small" onClick={() => void uploadCape()} disabled={busy}><Upload size={14} />{t('PNG pelerin yükle')}</button>
              {profile?.cape && <button className="button button-secondary button-small" onClick={() => setPendingAppearanceRemoval('cape')} disabled={busy}><Trash2 size={14} />{t('Pelerini kaldır')}</button>}
            </div>
          </div>
        </>
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
              <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void performAccountAction(() => window.nocturne.requestWestronPasswordReset({ email }))}>{t('Sıfırlama kodu iste')}</button>
              <label>{t('Sıfırlama kodu')}<input required minLength={40} maxLength={50} value={token} onChange={(event) => setToken(event.target.value)} /></label>
              <label>{t('Yeni parola')}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <button className="button button-primary button-small" disabled={busy}>{t('Parolayı yenile')}</button>
            </form>
          )}
        </>
      )}
      {pendingAppearanceRemoval && (
        <AppearanceRemovalModal
          appearanceType={pendingAppearanceRemoval}
          busy={busy}
          onCancel={() => setPendingAppearanceRemoval(null)}
          onConfirm={() => void confirmAppearanceRemoval()}
        />
      )}
      {error && <div className="account-message account-error">{error}</div>}
      {message && <div className="account-message">{message}</div>}
      <div className="settings-note"><ShieldCheck size={16} /><span>{t('Westron skin ve pelerinleri, başka launcher kullanan oyunculara da Westron Fabric modunu kullanmaları halinde görünür; modsuz istemciler özel görünümü alamaz. Diğer oyuncuların Westron profilini bulabilmesi için oyun adınız Westron kullanıcı adınızla aynı olmalıdır. Westron yüklemesi Microsoft hesabınızdaki skin veya pelerini değiştirmez.')}</span></div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, Box, Check, ChevronDown, CircleHelp, Compass, Image,
  Cpu, FolderOpen, Gamepad2, HardDrive, Layers3, LoaderCircle,
  LogOut, Package, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun,
  Trash2, Upload, UserRound, X,
} from 'lucide-react';

type ContentType = 'resourcepack' | 'shader';
type Page = 'home' | 'mods' | 'resourcepacks' | 'shaders' | 'library' | 'settings';
const IRIS_PROJECT_ID = 'YL57xq9U';

const pageLabels: Record<Page, string> = {
  home: 'Genel Bakış',
  mods: 'Mod keşfet',
  resourcepacks: 'Kaynak paketleri',
  shaders: 'Shader paketleri',
  library: 'Kütüphane',
  settings: 'Ayarlar',
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDownloads(value: number) {
  return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [state, setState] = useState<LauncherState | null>(null);
  const [offlineUsername, setOfflineUsername] = useState('Player');
  const [mods, setMods] = useState<ModrinthProject[]>([]);
  const [packProjects, setPackProjects] = useState<ModrinthProject[]>([]);
  const [query, setQuery] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [busy, setBusy] = useState('');
  const [installProgress, setInstallProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
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

  async function refresh() {
    setState(await window.nocturne.getState());
  }

  useEffect(() => {
    void Promise.resolve().then(() => window.nocturne.getState()).then((nextState) => {
      setState(nextState);
      setOfflineUsername(nextState.offlineUsername);
    }).catch(reportError);
  }, []);

  useEffect(() => window.nocturne.onGameExit((result) => {
    setBusy('');
    setInstallProgress(null);
    if (result.code !== 0 && !result.aborted) {
      setError(`Minecraft ${result.username} oturumu hata koduyla kapandı: ${result.code ?? result.signal}.`);
    } else {
      setNotice(`Minecraft ${result.username} oturumu kapandı.`);
    }
  }), []);

  useEffect(() => window.nocturne.onInstallProgress((progress) => {
    setInstallProgress(progress.overallPercent);
  }), []);

  useEffect(() => {
    const unsubscribe = window.nocturne.onUpdateStatus(setUpdateStatus);
    void window.nocturne.getUpdateStatus().then(setUpdateStatus).catch(reportError);
    return unsubscribe;
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    if (page !== 'mods' || mods.length > 0) return;
    void Promise.resolve().then(() => window.nocturne.searchMods('')).then(setMods).catch(reportError);
  }, [page]);

  useEffect(() => {
    if (page === 'resourcepacks') {
      setQuery('');
      void searchPacks('resourcepack', '');
    }
    if (page === 'shaders') {
      setQuery('');
      void searchPacks('shader', '');
    }
  }, [page]);

  useEffect(() => {
    if (!dependencyPrompt && !removalPrompt) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setDependencyPrompt(null);
        setRemovalPrompt(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dependencyPrompt, removalPrompt, busy]);

  async function installMod(projectId: string, modName: string, confirmedDependencyIds?: string[]) {
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
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('home'); }}>
          <span className="brand-mark"><Layers3 size={19} strokeWidth={1.8} /></span>
          <span className="brand-name">Westron<span>.</span><small>CLIENT</small></span>
        </a>

        <div className="nav-label">MENÜ</div>
        <nav className="nav-list">
          <NavButton icon={<Compass />} label="Genel Bakış" active={page === 'home'} onClick={() => setPage('home')} />
          <NavButton icon={<Sparkles />} label="Mod keşfet" active={page === 'mods'} onClick={() => setPage('mods')} badge="MODRINTH" />
          <NavButton icon={<Image />} label="Kaynak paketleri" active={page === 'resourcepacks'} onClick={() => setPage('resourcepacks')} />
          <NavButton icon={<Sun />} label="Shader paketleri" active={page === 'shaders'} onClick={() => setPage('shaders')} />
          <NavButton icon={<Package />} label="Kütüphane" active={page === 'library'} onClick={() => setPage('library')} count={installedCount} />
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-card">
          <span className="online-dot" />
          <div><strong>FABRIC READY</strong><small>Minecraft {state?.gameVersion ?? '26.3'}</small></div>
          <ShieldCheck size={16} className="sidebar-shield" />
        </div>
        <NavButton icon={<Settings2 />} label="Ayarlar" active={page === 'settings'} onClick={() => setPage('settings')} />
        <div className="sidebar-foot">WESTRON CLIENT <span>•</span> v{state?.displayVersion ?? '…'}</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>WESTRON CLIENT</span><ChevronDown size={13} /><strong>{pageLabels[page]}</strong></div>
          <div className="topbar-right">
            <span className="top-version"><span className="online-dot" />{state?.menuModInstalled ? 'Westron Client hazır' : state?.fabricInstalled ? 'Fabric kurulu' : 'Sürüm 26.3'}</span>
            <button className="icon-button" aria-label="Yardım" onClick={() => setNotice('Fabric kurulumu ve modlar için sol menüyü kullanın.')}><CircleHelp size={17} /></button>
            <div className="avatar">W</div>
          </div>
        </header>

        <div className="content">
          {error && <div className="toast toast-error"><X size={16} />{error}<button onClick={() => setError('')} aria-label="Kapat"><X size={15} /></button></div>}
          {notice && <div className="toast toast-success"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Kapat"><X size={15} /></button></div>}
          {updateStatus && ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'publishing', 'error'].includes(updateStatus.status) && (
            <UpdateBanner status={updateStatus} onCheck={() => { void checkForUpdates(); }} onDownload={() => { void downloadUpdate(); }} onRestart={() => {
              void window.nocturne.installUpdate().catch(reportError);
            }} />
          )}

          {page === 'home' && (
            <HomePage
              state={state}
              microsoftAccount={microsoftAccount}
              microsoftBusy={microsoftBusy}
              offlineUsername={offlineUsername}
              setOfflineUsername={setOfflineUsername}
              serverAddress={serverAddress}
              setServerAddress={setServerAddress}
              busy={busy}
              installProgress={installProgress}
              onInstall={() => perform('fabric', () => window.nocturne.installFabric(), (message) => message || 'Fabric profili hazır.')}
              onInstallMenu={() => perform('menu', () => window.nocturne.installMenu(), (message) => message || 'Westron Client arayüzü kuruldu.')}
              onLaunchGame={() => perform('launch', () => window.nocturne.launchGame(microsoftAccount
                ? { mode: 'microsoft' }
                : { mode: 'offline', offlineUsername }), (message) => message || 'Minecraft başlatıldı.')}
              onSignInMicrosoft={() => { void signInMicrosoft(); }}
              onCancelMicrosoftSignIn={() => { void cancelMicrosoftSignIn(); }}
              onSignOutMicrosoft={() => { void signOutMicrosoft(); }}
              onCopyServer={() => perform('server', () => window.nocturne.copyServer(serverAddress), () => 'Sunucu adresi panoya kopyalandı.')}
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
              fabricInstalled={Boolean(state?.fabricInstalled)}
              onInstallFabric={() => perform('fabric', () => window.nocturne.installFabric(), (message) => message || 'Fabric profili hazır.')}
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
              fabricInstalled={Boolean(state?.fabricInstalled)}
              irisInstalled={Boolean(state?.modrinthModProjects.includes(IRIS_PROJECT_ID))}
              onInstallFabric={() => perform('fabric', () => window.nocturne.installFabric(), (message) => message || 'Fabric profili hazır.')}
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
          {page === 'settings' && (
            <SettingsPage
              state={state}
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
    </div>
  );
}

function UpdateBanner({ status, onCheck, onDownload, onRestart }: {
  status: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}) {
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
          <strong>{status.status === 'available' ? `Westron Client ${status.version} hazır` : status.status === 'downloaded' ? 'Güncelleme kuruluma hazır' : status.status === 'up-to-date' ? 'Yeni güncelleme yok' : status.status === 'error' ? 'Güncelleme tamamlanamadı' : status.status === 'publishing' ? 'Güncelleme yayımlanıyor' : 'Westron Client güncelleniyor'}</strong>
          <span>Şu anki sürüm {status.currentVersion}</span>
        </div>
        <p>{status.message}</p>
        {downloading && (
          <div className="update-progress" aria-label={`İndirme yüzde ${status.percent ?? 0}`}>
            <span style={{ width: `${status.percent ?? 0}%` }} />
          </div>
        )}
        {status.status === 'available' && status.releaseNotes && <details className="update-notes"><summary>Sürüm notlarını gör</summary><p>{status.releaseNotes}</p></details>}
      </div>
      <div className="update-banner-actions">
        {status.status === 'available' && <button className="button button-primary button-small" onClick={onDownload}><ArrowDownToLine size={14} />İndir</button>}
        {status.status === 'downloaded' && <button className="button button-primary button-small" onClick={onRestart}><Play size={14} />Yeniden başlat</button>}
        {status.status === 'error' && <button className="button button-secondary button-small" onClick={onCheck}>Tekrar dene</button>}
        {(status.status === 'checking' || status.status === 'publishing') && <span className="update-checking">{status.status === 'publishing' ? `%${status.percent ?? 0}` : 'Kontrol ediliyor'}</span>}
      </div>
    </section>
  );
}

function UpdatePublisherPanel() {
  const [account, setAccount] = useState<WestronAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
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
      if (!result.cancelled) setMessage(result.message || 'Güncelleme yayımlandı.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel update-publisher-panel">
      <div className="settings-heading"><div className="card-icon blue"><Upload size={18} /></div><div><h3>Güncelleme yayımla</h3><span>Yalnızca Westron güncelleme yayıncısı kullanabilir.</span></div></div>
      <div className="update-settings-row">
        <span><code>release</code> klasörünü seçin; Setup, <code>.blockmap</code> ve <code>latest.yml</code> birlikte yayımlanır.</span>
        <button className="button button-secondary button-small" onClick={() => { void publish(); }} disabled={busy || !account.emailVerified}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
          {account.emailVerified ? 'Release dosyalarını seç' : 'Önce e-postayı doğrulayın'}
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
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label="Pencereyi kapat">
          <X size={17} />
        </button>
        <div className="eyebrow">MOD BAĞIMLILIKLARI</div>
        <h2 id="dependency-modal-title">Ek modlar gerekiyor</h2>
        <p id="dependency-modal-description">
          <strong>{modName}</strong> modunun çalışması için aşağıdaki modlar da yüklenmeli.
          Onayladığında hepsi birlikte indirilecek.
        </p>
        <div className="dependency-list" aria-label="İndirilecek gerekli modlar">
          {dependencies.map((dependency) => (
            <div className="dependency-item" key={dependency.projectId}>
              <span className="dependency-item-icon"><Package size={15} /></span>
              <span>{dependency.title}</span>
              <Check size={15} className="dependency-item-check" />
            </div>
          ))}
        </div>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>Vazgeç</button>
          <button className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}
            Gerekli modlarla indir
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
  const contentLabel = contentType === 'mod'
    ? 'Mod'
    : contentType === 'resourcepack' ? 'Kaynak paketini' : 'Shader paketini';
  const folderLabel = contentType === 'mod'
    ? 'mods'
    : contentType === 'resourcepack' ? 'resourcepacks' : 'shaderpacks';
  return (
    <div className="dependency-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="dependency-modal remove-modal" role="dialog" aria-modal="true" aria-labelledby="remove-modal-title">
        <div className="dependency-modal-icon remove-modal-icon"><Trash2 size={20} /></div>
        <button className="dependency-modal-close" onClick={onCancel} disabled={busy} aria-label="Pencereyi kapat"><X size={17} /></button>
        <div className="eyebrow">{contentType === 'mod' ? 'MOD KÜTÜPHANESİ' : 'MODRINTH PAKETLERİ'}</div>
        <h2 id="remove-modal-title">{contentLabel} kaldırmak istiyor musun?</h2>
        <p><strong>{fileName}</strong> ({formatBytes(size)}) Minecraft {folderLabel} klasöründen kaldırılacak. Bu işlem geri alınamaz.</p>
        <div className="dependency-modal-actions">
          <button className="button button-ghost" onClick={onCancel} disabled={busy}>Vazgeç</button>
          <button className="button button-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
            Evet, modu kaldır
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

function HomePage({ state, microsoftAccount, microsoftBusy, offlineUsername, setOfflineUsername, serverAddress, setServerAddress, busy, installProgress, onInstall, onInstallMenu, onLaunchGame, onSignInMicrosoft, onCancelMicrosoftSignIn, onSignOutMicrosoft, onCopyServer, onOpenSettings, onMods }: {
  state: LauncherState | null; microsoftAccount: MicrosoftAccount | null; microsoftBusy: boolean;
  offlineUsername: string; setOfflineUsername: (value: string) => void;
  serverAddress: string; setServerAddress: (value: string) => void;
  busy: string; installProgress: number | null; onInstall: () => void; onInstallMenu: () => void; onLaunchGame: () => void; onCopyServer: () => void;
  onSignInMicrosoft: () => void; onCancelMicrosoftSignIn: () => void; onSignOutMicrosoft: () => void;
  onOpenSettings: () => void; onMods: () => void;
}) {
  const fabricReady = Boolean(state?.fabricInstalled);
  const ready = fabricReady && Boolean(state?.menuModInstalled);
  const primaryAction = !fabricReady ? onInstall : !state?.menuModInstalled ? onInstallMenu : onLaunchGame;
  const primaryLabel = !fabricReady ? 'Fabric’i kur' : !state?.menuModInstalled ? 'Oyun arayüzünü ekle' : 'Oyunu başlat';
  return (
    <>
      <PageHeading eyebrow="HOŞ GELDİN" title="Oyunun, senin tarzın." description="Minecraft deneyimini tek yerden yönet. Fabric ile özgürce modla, kendi dünyanı kur." />

      <section className="hero-card">
        <div className="hero-grid" />
        <div className="hero-copy">
          <div className="hero-tag"><span className="online-dot" /> SEASON 01 <span className="tag-divider">/</span> FABRIC EDITION</div>
          <h2>Biraz daha<br /><em>sana ait.</em></h2>
          <p>Temiz bir başlangıç. Sınırsız mod. Senin Minecraft’ın.</p>
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
                <button className="microsoft-signout" onClick={onSignOutMicrosoft} disabled={microsoftBusy} aria-label="Microsoft hesabından çıkış yap" title="Microsoft hesabından çıkış yap">
                  {microsoftBusy ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}
                </button>
              </div>
            ) : (
              <>
                <label className="offline-username">
                  <span>ÇEVRİMDIŞI KULLANICI ADI</span>
                  <input
                    value={offlineUsername}
                    onChange={(event) => setOfflineUsername(event.target.value)}
                    maxLength={16}
                    autoComplete="username"
                    spellCheck={false}
                    aria-label="Çevrimdışı kullanıcı adı"
                  />
                </label>
                <div className="microsoft-login-group">
                  <button
                    className="button button-microsoft"
                    onClick={onSignInMicrosoft}
                    disabled={microsoftBusy || !state?.microsoftAuthConfigured}
                    title={state?.microsoftAuthConfigured ? 'Microsoft ile güvenli giriş' : 'Önce Microsoft Client ID yapılandırılmalı'}
                  >
                    {microsoftBusy ? <LoaderCircle className="spin" size={16} /> : <MicrosoftMark />}
                    Microsoft ile Giriş Yap
                  </button>
                  {microsoftBusy && <button className="microsoft-cancel" onClick={onCancelMicrosoftSignIn}>Girişi iptal et</button>}
                  {!state?.microsoftAuthConfigured && <small>MINECRAFT_KIT_MSA_CLIENT_ID ayarlanmalı</small>}
                </div>
              </>
            )}
            <button className="button button-primary button-large" onClick={primaryAction} disabled={Boolean(busy) || (!microsoftAccount && ready && !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername))}>
              {busy === 'fabric' || busy === 'launch' || busy === 'menu' ? <LoaderCircle className="spin" size={17} /> : ready ? <Play size={17} fill="currentColor" /> : <ArrowDownToLine size={17} />}
              {busy === 'launch' && installProgress !== null ? `İndiriliyor %${Math.round(installProgress)}` : primaryLabel}
              <ArrowRight size={15} />
            </button>
            <button className="button button-ghost" onClick={onMods}><Sparkles size={16} />Modları keşfet</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="cube cube-back" /><div className="cube cube-main"><div className="cube-face cube-top" /><div className="cube-face cube-left" /><div className="cube-face cube-right" /></div>
          <div className="art-ring ring-one" /><div className="art-ring ring-two" />
          <span className="art-coordinate">-128 / 72 / 304</span>
          <span className="art-label">OVERWORLD <b>01</b></span>
        </div>
        <div className="hero-bottom"><span><span className="online-dot" /> STABLE RELEASE</span><span>MINECRAFT <b>{state?.gameVersion ?? '26.3'}</b></span><span>BUILT FOR YOUR WORLD</span></div>
      </section>

      <div className="section-title"><div><span className="eyebrow">HIZLI ERİŞİM</span><h3>Her şey yerli yerinde.</h3></div><button className="text-button" onClick={onOpenSettings}>Tüm ayarlar <ArrowRight size={14} /></button></div>
      <div className="dashboard-grid">
        <div className="info-card install-card">
          <div className="card-icon violet"><Layers3 size={18} /></div><span className="card-kicker">MOD YÜKLEYİCİ</span>
          <div className="card-main"><strong>{ready ? 'Westron Client hazır' : fabricReady ? 'Oyun arayüzünü ekle' : 'Fabric’i kur'}</strong><span>{ready ? 'Özel oyun arayüzü etkin.' : fabricReady ? 'Özel oyun arayüzünü kur.' : '26.3 için tek tıkla kurulum.'}</span></div>
          <button className="round-arrow" onClick={primaryAction} disabled={Boolean(busy)} aria-label={primaryLabel}><ArrowRight size={17} /></button>
        </div>
        <div className="info-card">
          <div className="card-icon blue"><Box size={18} /></div><span className="card-kicker">MOD KÜTÜPHANESİ</span>
          <div className="card-main"><strong>{state?.mods.length ?? 0} mod yüklü</strong><span>Uyumlu modları keşfet ve yönet.</span></div>
          <button className="round-arrow" onClick={onMods} aria-label="Modları keşfet"><ArrowRight size={17} /></button>
        </div>
        <div className="info-card server-card">
          <div className="card-icon green"><Gamepad2 size={18} /></div><span className="card-kicker">SUNUCUYA KATIL</span>
          <div className="server-input-row">
            <input value={serverAddress} onChange={(event) => setServerAddress(event.target.value)} placeholder="play.sunucun.com" aria-label="Minecraft sunucu adresi" />
            <button className="round-arrow" onClick={onCopyServer} disabled={!serverAddress || Boolean(busy)} aria-label="Sunucu adresini kopyala"><ArrowRight size={17} /></button>
          </div>
          <span className="server-hint">Adresi panoya kopyala, oyunda bağlan.</span>
        </div>
      </div>

      <div className="status-row">
        <div className="status-item"><span className={`status-indicator ${state?.javaAvailable ? 'good' : 'warn'}`} /><span>JAVA RUNTIME</span><strong>{state?.javaAvailable ? 'Algılandı' : 'Bulunamadı'}</strong></div>
        <div className="status-separator" />
        <div className="status-item"><HardDrive size={15} /><span>OYUN DİZİNİ</span><strong className="path-value" title={state?.minecraftDir}>{state?.minecraftDir ?? 'Yükleniyor…'}</strong></div>
        <button className="status-change" onClick={onOpenSettings}>Değiştir <ArrowRight size={13} /></button>
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

function ModsPage({ mods, query, setQuery, busy, installedMods, installedProjectIds, onSearch, onInstall, onRemove, onOpenFolder, fabricInstalled, onInstallFabric }: {
  mods: ModrinthProject[]; query: string; setQuery: (value: string) => void; busy: string;
  installedMods: LauncherState['mods']; installedProjectIds: string[]; onSearch: () => void; onInstall: (id: string, name: string) => void;
  onRemove: (name: string) => void; onOpenFolder: () => void; fabricInstalled: boolean; onInstallFabric: () => void;
}) {
  return (
    <>
      <PageHeading eyebrow="MODRINTH • FABRIC 26.3" title="Dünyanı genişlet." description="Seçkin modları keşfet, tek tıkla kur ve oyununu kendine göre şekillendir.">
        <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={16} />Mod klasörü</button>
      </PageHeading>
      {!fabricInstalled && <div className="inline-callout"><Layers3 size={17} /><span><strong>Önce Fabric gerekli.</strong> Modları yüklemeden önce Fabric 26.3 profilini kur.</span><button className="button button-primary button-small" onClick={onInstallFabric} disabled={Boolean(busy)}>{busy === 'fabric' ? <LoaderCircle className="spin" size={14} /> : <ArrowDownToLine size={14} />}Fabric’i kur</button></div>}
      <div className="mods-toolbar">
        <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder="Mod adı, ör. Sodium" /><kbd>ENTER</kbd></div>
        <button className="button button-secondary search-button" onClick={onSearch} disabled={busy === 'search'}>{busy === 'search' ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}Ara</button>
      </div>
      <div className="results-heading"><div><span className="eyebrow">ÖNE ÇIKANLAR</span><span className="result-count">{mods.length ? `${mods.length} sonuç` : 'Aramaya başla'}</span></div><span className="compatibility"><span className="online-dot" />FABRIC 26.3 UYUMLU</span></div>
      <div className="mod-grid">
        {mods.map((mod) => {
          const installed = installedProjectIds.includes(mod.id)
            || installedMods.some((item) => item.name.toLowerCase().includes(mod.slug.toLowerCase()));
          const isInstalling = busy === `mod:${mod.id}`;
          return <article className="mod-card" key={mod.id}>
            <div className="mod-card-head">
              {mod.iconUrl ? <img className="mod-icon" src={mod.iconUrl} alt="" /> : <div className="mod-icon mod-icon-fallback"><Box size={20} /> </div>}
              <div className="mod-title"><h3>{mod.title}</h3><span>{formatDownloads(mod.downloads)} indirme</span></div>
              <button className={`mod-action ${installed ? 'is-installed' : ''}`} title={installed ? 'En yeni uyumlu sürümü yükle' : 'Yükle'} disabled={Boolean(busy) || !fabricInstalled} onClick={() => onInstall(mod.id, mod.title)}>
                {isInstalling ? <LoaderCircle className="spin" size={16} /> : installed ? <RefreshCw size={16} /> : <Plus size={16} />}
              </button>
            </div>
            <p>{mod.description}</p>
            <div className="mod-tags">{mod.categories.slice(0, 2).map((category) => <span key={category}>{category.replaceAll('-', ' ')}</span>)}<span className="fabric-tag">FABRIC</span></div>
          </article>;
        })}
      </div>
      {!mods.length && <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>Mod keşfine başla</strong><span>Arama yap veya bekleyin; popüler modlar listelenecek.</span></div>}
      {installedMods.length > 0 && <section className="installed-section"><div className="section-title compact"><div><span className="eyebrow">YÜKLÜ MODLAR</span><h3>Kütüphanen</h3></div><span className="result-count">{installedMods.length} dosya</span></div><ModList mods={installedMods} busy={busy} onRemove={onRemove} /></section>}
    </>
  );
}

function ModrinthPackPage({ type, projects, query, setQuery, busy, installedFiles, installedProjectIds, fabricInstalled, irisInstalled, onSearch, onInstall, onRemove, onOpenFolder, onInstallFabric, onInstallIris }: {
  type: ContentType;
  projects: ModrinthProject[];
  query: string;
  setQuery: (value: string) => void;
  busy: string;
  installedFiles: LauncherState['resourcePacks'];
  installedProjectIds: string[];
  fabricInstalled: boolean;
  irisInstalled: boolean;
  onSearch: () => void;
  onInstall: (id: string, title: string) => void;
  onRemove: (fileName: string) => void;
  onOpenFolder: () => void;
  onInstallFabric: () => void;
  onInstallIris: () => void;
}) {
  const isShader = type === 'shader';
  const label = isShader ? 'Shader paketleri' : 'Kaynak paketleri';
  const folder = isShader ? 'shaderpacks' : 'resourcepacks';
  const searchBusy = busy === `search:${type}`;
  return (
    <>
      <PageHeading
        eyebrow="MODRINTH • MINECRAFT 26.3"
        title={isShader ? 'Işığı değiştir.' : 'Dünyanı yeniden tasarla.'}
        description={isShader
          ? 'Minecraft 26.3 ile uyumlu shader paketlerini keşfet ve tek tıkla yükle.'
          : 'Minecraft 26.3 ile uyumlu kaynak paketlerini keşfet ve tek tıkla yükle.'}
      >
        <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={16} />{folder} klasörü</button>
      </PageHeading>
      {isShader && !fabricInstalled && (
        <div className="inline-callout">
          <Layers3 size={17} />
          <span><strong>Önce Fabric gerekli.</strong> Shader paketlerini çalıştırmak için önce Fabric 26.3 profilini kur.</span>
          <button className="button button-primary button-small" onClick={onInstallFabric} disabled={Boolean(busy)}>
            {busy === 'fabric' ? <LoaderCircle className="spin" size={14} /> : <ArrowDownToLine size={14} />}Fabric’i kur
          </button>
        </div>
      )}
      {isShader && fabricInstalled && !irisInstalled && (
        <div className="inline-callout">
          <Sun size={17} />
          <span><strong>Shader motoru gerekli.</strong> Paketleri oyunda etkinleştirmek için Minecraft 26.3 uyumlu Iris kurulmalı.</span>
          <button className="button button-primary button-small" onClick={onInstallIris} disabled={Boolean(busy)}>
            {busy === `mod:${IRIS_PROJECT_ID}` ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}Iris’i kur
          </button>
        </div>
      )}
      {isShader && fabricInstalled && irisInstalled && (
        <div className="inline-callout">
          <Check size={17} />
          <span><strong>Iris hazır.</strong> Kurduğun shader paketlerini oyunun video ayarlarından seçebilirsin.</span>
        </div>
      )}
      <div className="mods-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
            placeholder={isShader ? 'Shader adı, ör. Complementary' : 'Paket adı, ör. Faithful'}
          />
          <kbd>ENTER</kbd>
        </div>
        <button className="button button-secondary search-button" onClick={onSearch} disabled={searchBusy}>
          {searchBusy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}Ara
        </button>
      </div>
      <div className="results-heading">
        <div><span className="eyebrow">MINECRAFT 26.3 UYUMLU</span><span className="result-count">{projects.length ? `${projects.length} sonuç` : 'Aramaya başla'}</span></div>
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
                <div className="mod-title"><h3>{project.title}</h3><span>{formatDownloads(project.downloads)} indirme</span></div>
                <button
                  className={`mod-action ${installed ? 'is-installed' : ''}`}
                  title={installed ? 'En yeni uyumlu sürümü yükle' : 'Yükle'}
                  aria-label={`${project.title} ${installed ? 'güncelle' : 'yükle'}`}
                  disabled={Boolean(busy)}
                  onClick={() => onInstall(project.id, project.title)}
                >
                  {isInstalling ? <LoaderCircle className="spin" size={16} /> : installed ? <RefreshCw size={16} /> : <Plus size={16} />}
                </button>
              </div>
              <p>{project.description}</p>
              <div className="mod-tags">
                {project.categories.slice(0, 2).map((category) => <span key={category}>{category.replaceAll('-', ' ')}</span>)}
                <span className="fabric-tag">26.3 UYUMLU</span>
              </div>
            </article>
          );
        })}
      </div>
      {!projects.length && (
        <div className="empty-state">
          <div className="empty-icon">{isShader ? <Sun size={22} /> : <Image size={22} />}</div>
          <strong>{label} keşfine başla</strong>
          <span>Arama yap veya popüler Modrinth paketlerini listelemek için bekle.</span>
        </div>
      )}
      {installedFiles.length > 0 && (
        <section className="installed-section">
          <div className="section-title compact">
            <div><span className="eyebrow">YÜKLÜ PAKETLER</span><h3>{label}</h3></div>
            <span className="result-count">{installedFiles.length} dosya</span>
          </div>
          <div className="mod-list">
            {installedFiles.map((file) => (
              <div className="mod-list-item" key={file.name}>
                <div className="list-mod-icon">{isShader ? <Sun size={16} /> : <Image size={16} />}</div>
                <div className="list-mod-name"><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
                <span className="list-mod-type">ZIP PAKET</span>
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
  return (
    <>
      <PageHeading eyebrow="OYUN DOSYALARI" title="Kütüphanen." description="Yüklü modlarını yönet, dosya konumuna git ve koleksiyonunu büyüt.">
        <button className="button button-secondary" onClick={onOpenFolder}><FolderOpen size={16} />Klasörü aç</button>
      </PageHeading>
      <div className="library-summary">
        <div className="library-stat"><div className="card-icon violet"><Package size={19} /></div><div><strong>{state?.mods.length ?? 0}</strong><span>YÜKLÜ MOD</span></div></div>
        <div className="library-stat"><div className="card-icon blue"><Layers3 size={19} /></div><div><strong>{state?.fabricInstalled ? 'Hazır' : 'Kurulmadı'}</strong><span>FABRIC PROFİLİ</span></div></div>
        <div className="library-stat"><div className="card-icon green"><Cpu size={19} /></div><div><strong>{state?.gameVersion ?? '26.3'}</strong><span>MINECRAFT SÜRÜMÜ</span></div></div>
      </div>
      {state?.mods.length ? <div className="library-panel"><div className="panel-heading"><div><h3>Mod dosyaları</h3><span>Minecraft mods klasöründeki JAR dosyaları</span></div><button className="button button-secondary button-small" onClick={onMods}><Sparkles size={14} />Mod keşfet</button></div><ModList mods={state.mods} busy={busy} onRemove={onRemove} /></div> :
        <div className="empty-state library-empty"><div className="empty-icon"><Package size={22} /></div><strong>Kütüphanen henüz boş.</strong><span>Modrinth kataloğundan sevdiğin modları eklemeye başla.</span><button className="button button-primary button-small" onClick={onMods}><Sparkles size={14} />Mod keşfet</button></div>}
    </>
  );
}

function ModList({ mods, busy, onRemove }: { mods: LauncherState['mods']; busy: string; onRemove: (name: string) => void }) {
  return <div className="mod-list">{mods.map((mod) => <div className="mod-list-item" key={mod.name}>
    <div className="list-mod-icon"><Package size={16} /></div><div className="list-mod-name"><strong>{mod.name}</strong><span>{formatBytes(mod.size)}</span></div>
    <span className="list-mod-type">JAR MOD</span><button className="remove-mod" aria-label={`${mod.name} dosyasını kaldır`} disabled={Boolean(busy)} onClick={() => onRemove(mod.name)}>{busy === `remove:${mod.name}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button>
  </div>)}</div>;
}

function SettingsPage({ state, onChooseFolder, busy, updateStatus, onCheckUpdates }: {
  state: LauncherState | null; onChooseFolder: () => void; busy: string;
  updateStatus: UpdateStatus | null; onCheckUpdates: () => void;
}) {
  return (
    <>
      <PageHeading eyebrow="TERCİHLER" title="Ayarlar." description="Oyun dosyalarının konumunu ve sistem durumunu düzenle." />
      <section className="settings-panel">
        <div className="settings-heading"><div className="card-icon violet"><Settings2 size={18} /></div><div><h3>Oyun kurulumu</h3><span>Dosyaların nerede tutulacağını seç.</span></div></div>
        <div className="setting-row"><div><strong>Minecraft klasörü</strong><span>Fabric profili ve modların yükleneceği dizin.</span><code title={state?.minecraftDir}>{state?.minecraftDir ?? 'Yükleniyor…'}</code></div><button className="button button-secondary button-small" onClick={onChooseFolder} disabled={Boolean(busy)}><FolderOpen size={15} />Klasör seç</button></div>
        <div className="setting-row"><div><strong>Minecraft sürümü</strong><span>Fabric ve Modrinth uyumluluk hedefi.</span></div><span className="setting-value">26.3 <span className="stable-pill"><span className="online-dot" />KARARLI</span></span></div>
      </section>
      <WestronAccountPanel />
      <section className="settings-panel system-panel">
        <div className="settings-heading"><div className="card-icon blue"><Cpu size={18} /></div><div><h3>Sistem durumu</h3><span>Kurulum için gerekli bileşenler.</span></div></div>
        <div className="system-row"><span>Java runtime</span><strong className={state?.javaAvailable ? 'text-good' : 'text-warn'}>{state?.javaAvailable ? 'Algılandı' : 'Kurulacak'}</strong><span className="system-path">{state?.javaAvailable || 'Oyun dosyalarıyla birlikte otomatik hazırlanır.'}</span></div>
        <div className="system-row"><span>Fabric Loader</span><strong className={state?.fabricInstalled ? 'text-good' : ''}>{state?.fabricInstalled ? 'Kurulu' : 'Kurulmadı'}</strong><span className="system-path">Otomatik olarak kararlı sürüm kurulur.</span></div>
        <div className="system-row"><span>Westron Client arayüzü</span><strong className={state?.menuModInstalled ? 'text-good' : ''}>{state?.menuModInstalled ? 'Kurulu' : 'Kurulmadı'}</strong><span className="system-path">Oyun içindeki duraklatma ekranını değiştirir.</span></div>
      </section>
      <section className="settings-panel update-settings">
        <div className="settings-heading"><div className="card-icon violet"><ArrowDownToLine size={18} /></div><div><h3>Westron Client güncellemeleri</h3><span>Kurulu sürüm {state?.displayVersion ?? '…'} · Güncellemeler HTTPS üzerinden alınır.</span></div></div>
        <div className="update-settings-row">
          <span>{updateStatus?.message ?? 'Yeni sürümleri istediğin zaman kontrol edebilirsin.'}</span>
          <button className="button button-secondary button-small" onClick={onCheckUpdates} disabled={updateStatus?.status === 'checking'}>
            {updateStatus?.status === 'checking' ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
            Güncellemeleri denetle
          </button>
        </div>
      </section>
      <UpdatePublisherPanel />
      <div className="settings-note"><ShieldCheck size={17} /><span>Minecraft, giriş yöntemi olarak ana ekranda seçilen doğrulanmış Microsoft hesabını veya ayrı çevrimdışı kullanıcı adını kullanır. Westron Skin hesabı oyun oturumu sağlamaz.</span></div>
    </>
  );
}

function WestronAccountPanel() {
  const [account, setAccount] = useState<WestronAccount | null>(null);
  const [profile, setProfile] = useState<WestronProfile | null>(null);
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

  useEffect(() => {
    void window.nocturne.getWestronAccount().then(async (savedAccount) => {
      setAccount(savedAccount);
      if (savedAccount) setProfile(await window.nocturne.getWestronProfile());
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  async function performAccountAction(action: () => Promise<string | WestronAccount | void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (typeof result === 'string') setMessage(result);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
      setAccount(result);
      setForm('login');
      await window.nocturne.getWestronProfile().then(setProfile).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
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
      if (upload.cancelled) return 'Skin seçimi iptal edildi.';
      setProfile(upload.profile ?? null);
      return 'Skin Westron hesabınıza yüklendi.';
    });
    void result;
  }

  async function refreshSkinProfile() {
    setProfileRefreshing(true);
    setError('');
    try {
      setProfile(await window.nocturne.getWestronProfile());
      setMessage('Westron skin profili güncellendi.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProfileRefreshing(false);
    }
  }

  async function logout() {
    await performAccountAction(async () => {
      const result = await window.nocturne.logoutWestronAccount();
      setAccount(null);
      setProfile(null);
      return result;
    });
  }

  return (
    <section className="settings-panel">
      <div className="settings-heading">
        <div className="card-icon violet"><UserRound size={18} /></div>
        <div><h3>Westron hesabı ve skin</h3><span>Minecraft adın farklı olsa da launcher kendi skinini hesabınla eşleştirir.</span></div>
      </div>
      {account ? (
        <>
          <div className="setting-row">
            <div><strong>{account.username}</strong><span>{account.email} · {account.emailVerified ? 'E-posta doğrulandı' : 'Doğrulanmadı'}</span></div>
            <button className="button button-secondary button-small" onClick={() => void logout()} disabled={busy}><LogOut size={14} />Çıkış yap</button>
          </div>
          <div className="setting-row">
            <div className="skin-profile-summary">
              {profile?.skin
                ? <img className="skin-preview" src={profile.skin.url} alt="Westron hesabındaki mevcut skin" />
                : <span className="skin-preview skin-preview-empty"><UserRound size={17} /></span>}
              <span><strong>Westron skin profili</strong><small>{profile?.skin ? `${profile.skin.model} modeli · ${new Date(profile.skin.updatedAt).toLocaleDateString('tr-TR')}` : 'Henüz skin yüklenmedi. PNG dosyanı yükleyebilirsin.'}</small></span>
            </div>
            <div className="account-actions">
              <select aria-label="Skin modeli" value={skinModel} onChange={(event) => setSkinModel(event.target.value as 'classic' | 'slim')}>
                <option value="classic">Classic</option>
                <option value="slim">Slim</option>
              </select>
              <button className="button button-secondary button-small" onClick={() => void refreshSkinProfile()} disabled={busy || profileRefreshing}>
                {profileRefreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                Yenile
              </button>
              <button className="button button-secondary button-small" onClick={() => void uploadSkin()} disabled={busy}><Upload size={14} />PNG skin yükle</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="account-tabs">
            <button className={form === 'login' ? 'selected' : ''} onClick={() => setForm('login')}>Giriş yap</button>
            <button className={form === 'register' ? 'selected' : ''} onClick={() => setForm('register')}>Hesap oluştur</button>
          </div>
          {form === 'login' && (
            <form className="account-form" onSubmit={(event) => void submitLogin(event)}>
              <label>E-posta<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Parola<input type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <div className="account-form-actions">
                <button className="button button-primary button-small" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null}Giriş yap</button>
                <button type="button" className="text-button" onClick={() => setForm('reset')}>Parolamı unuttum</button>
                <button type="button" className="text-button" onClick={() => setForm('verify')}>E-postayı doğrula</button>
              </div>
            </form>
          )}
          {form === 'register' && (
            <form className="account-form" onSubmit={(event) => void submitRegistration(event)}>
              <label>Kullanıcı adı<input autoComplete="username" required minLength={3} maxLength={16} pattern="[A-Za-z0-9_]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
              <label>E-posta<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Parola<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <div className="account-form-actions">
                <button className="button button-primary button-small" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null}Hesap oluştur</button>
                <button type="button" className="text-button" onClick={() => setForm('verify')}>Doğrulama kodum var</button>
              </div>
            </form>
          )}
          {form === 'verify' && (
            <form className="account-form" onSubmit={(event) => void submitVerification(event)}>
              <p>E-postanıza gelen tek kullanımlık kodu girin.</p>
              <label>E-posta<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Doğrulama kodu<input required minLength={40} maxLength={50} value={token} onChange={(event) => setToken(event.target.value)} /></label>
              <div className="account-form-actions">
                <button className="button button-primary button-small" disabled={busy}>E-postayı doğrula</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => void performAccountAction(() => window.nocturne.resendWestronVerification({ email }))}>Kodu yeniden gönder</button>
              </div>
            </form>
          )}
          {form === 'reset' && (
            <form className="account-form" onSubmit={(event) => void submitPasswordReset(event)}>
              <p>Sıfırlama kodu almak için hesabınızın e-posta adresini girin.</p>
              <label>E-posta<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void performAccountAction(() => window.nocturne.requestWestronPasswordReset({ email }))}>Sıfırlama kodu iste</button>
              <label>Sıfırlama kodu<input required minLength={40} maxLength={50} value={token} onChange={(event) => setToken(event.target.value)} /></label>
              <label>Yeni parola<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <button className="button button-primary button-small" disabled={busy}>Parolayı yenile</button>
            </form>
          )}
        </>
      )}
      {error && <div className="account-message account-error">{error}</div>}
      {message && <div className="account-message">{message}</div>}
      <div className="settings-note"><ShieldCheck size={16} /><span>Skinler Westron, orijinal Minecraft ve TLauncher kaynaklarından istemci tarafında alınır; sunucu eklentisi gerekmez. Görünmeleri için oyuncuların Westron Fabric modunu kullanması gerekir; modsuz istemciler bu skinleri göremez. Oyuncu adları herkese açık profil sorguları için Mojang ve TLauncher servislerine gönderilir; TLauncher servisi resmi olarak belgelenmemiştir. Westron skin yüklemesi Microsoft hesabındaki skini değiştirmez.</span></div>
    </section>
  );
}

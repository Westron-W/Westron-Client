const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../../package.json');
const lockfile = require('../../package-lock.json');
const macBuild = require('../../macos-client/electron-builder.json');
const { UPDATE_FEED, configureUpdateFeed } = require('../update-config.cjs');
const fs = require('node:fs');

test('package and lockfile versions are aligned for release metadata', () => {
  assert.equal(packageJson.version, '1.0.3');
  assert.equal(packageJson.version, lockfile.version);
  assert.equal(packageJson.version, lockfile.packages[''].version);
  const mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(mainCode, /const DISPLAY_VERSION = packageJson\.version;/);
  assert.match(mainCode, /const RELEASE_VERSION = packageJson\.version;/);
  assert.match(mainCode, /process\.platform === 'win32'/);
  assert.match(mainCode, /process\.env\.APPDATA/);
  assert.match(mainCode, /resolveDefaultMinecraftDir\(appDataDirectory, process\.platform\)/);
  assert.match(mainCode, /path\.join\(targetMinecraftDir, 'westron-profiles'\)/);
  assert.match(mainCode, /migrateLegacyMinecraftProfiles\(legacyDirectory, targetMinecraftDir\)/);
  assert.match(mainCode, /const minecraftDir = process\.platform === 'win32'/);
});

test('Windows updater uses a hidden generic feed and releases show only installers', () => {
  assert.equal(packageJson.build.nsis.include, 'build/installer.nsh');
  assert.ok(packageJson.build.win.target.some
    ? packageJson.build.win.target.some((target) => target === 'nsis')
    : packageJson.build.win.target === 'nsis');
  assert.ok(packageJson.build.publish.some((provider) =>
    provider.provider === 'github'
    && provider.owner === 'Westron-W'
    && provider.repo === 'Westron-Client'
    && provider.releaseType === 'release'));
  let feed;
  assert.equal(configureUpdateFeed({ setFeedURL: (value) => { feed = value; } }, 'win32'), true);
  assert.deepEqual(feed, UPDATE_FEED);
  assert.deepEqual(feed, {
    provider: 'generic',
    url: 'https://raw.githubusercontent.com/Westron-W/Westron-Client/updates-feed/',
  });
  assert.equal(configureUpdateFeed({ setFeedURL: () => assert.fail('macOS must not configure the Windows feed') }, 'darwin'), false);
  const mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(mainCode, /configureUpdateFeed\(autoUpdater, process\.platform\)/);
  assert.match(mainCode, /autoUpdater\.disableDifferentialDownload = true/);
  const releaseWorkflow = fs.readFileSync('.github/workflows/build-release.yml', 'utf8');
  assert.match(releaseWorkflow, /name: Checkout repository[\s\S]*uses: actions\/checkout@v4/);
  assert.match(releaseWorkflow, /westron-client-update-feed/);
  assert.match(releaseWorkflow, /release\/feed\/latest\.yml/);
  assert.match(releaseWorkflow, /git -C "\$FEED_WORKTREE" push --force origin updates-feed/);
  assert.match(releaseWorkflow, /releases\/download\/\$\{RELEASE_TAG\}\/Windows-Westron-Launcher-Setup-\$\{VERSION\}\.exe/);
  assert.match(releaseWorkflow, /softprops\/action-gh-release/);
  assert.match(releaseWorkflow, /release\/windows\/Windows-Westron-Launcher-Setup-\*\.exe/);
  assert.match(releaseWorkflow, /ASSET in[\s\S]*Westron-Launcher-Setup-\$\{VERSION\}\.exe\.blockmap/);
  assert.match(releaseWorkflow, /release\/macos\/MacOS-Westron-Launcher-\*\.dmg/);
  assert.match(releaseWorkflow, /GitHub Release must contain only the Windows EXE and macOS DMG/);
  assert.match(releaseWorkflow, /release_tag:/);
  assert.match(releaseWorkflow, /startsWith\(github\.event\.head_commit\.message, '\[publish-release\]'\)/);
  assert.match(releaseWorkflow, /Verify published installer assets/);
  assert.match(releaseWorkflow, /gh release view "\$RELEASE_TAG"/);
  assert.match(releaseWorkflow, /gh release delete-asset/);
  assert.doesNotMatch(releaseWorkflow, /release\/windows\/Westron-Launcher-Setup-\*\.exe\.blockmap/);
  assert.doesNotMatch(releaseWorkflow, /release\/windows\/latest\.yml/);
  assert.match(packageJson.dependencies['electron-updater'], /^\^/);
  assert.equal(packageJson.build.win.icon, 'build/westron-launcher.ico');
  assert.equal(packageJson.build.nsis.installerIcon, 'build/westron-launcher.ico');
  assert.equal(packageJson.build.nsis.uninstallerIcon, 'build/westron-launcher.ico');
  assert.deepEqual(packageJson.build.extraResources[0], {
    from: 'build/westron-launcher.ico',
    to: 'westron-launcher.ico',
  });
  assert.equal(fs.existsSync('build/westron-launcher.ico'), true);
  assert.equal(packageJson.build.artifactName, `Westron-Launcher-Setup-${packageJson.version}.exe`);
  assert.equal(packageJson.build.nsis.installerSidebar, 'build/installer-sidebar.bmp');
  assert.equal(packageJson.build.nsis.uninstallerSidebar, 'build/installer-sidebar.bmp');
  assert.equal(packageJson.build.nsis.installerHeader, 'build/installer-header.bmp');
  assert.equal(fs.existsSync(packageJson.build.nsis.installerSidebar), true);
  assert.equal(fs.existsSync(packageJson.build.nsis.installerHeader), true);
  const installerScript = fs.readFileSync(packageJson.build.nsis.include, 'utf8');
  assert.equal(fs.existsSync(packageJson.build.nsis.include), true);
  assert.match(installerScript, /!macro customWelcomePage/);
  assert.match(installerScript, /WESTRON_WELCOME_TITLE 1055/);
  assert.match(installerScript, /WESTRON_WELCOME_TITLE 1033/);
  assert.match(installerScript, /MUI_WELCOMEPAGE_TITLE_3LINES/);
  assert.match(installerScript, /Hoş Geldiniz!/);
  assert.match(installerScript, /Bu yükleyici Westron Launcher'ı/);
  assert.match(installerScript, /MUI_BGCOLOR "241A3A"/);

  const appCode = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(appCode, /className="window-controls"/);
  assert.match(appCode, /className="topbar-right"/);
  assert.match(appCode, /className="topbar-right">[\s\S]*className="top-version"[\s\S]*className="topbar-profile"/);
  assert.match(appCode, /label={text\('Westron Launcher Modu'\)}/);
  assert.match(appCode, /function PerformanceModesPage/);
  const launcherMainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(launcherMainCode, /ipcMain\.handle\('app:install-performance-preset'/);
  assert.match(appCode, /<p>\{status\.message \? t\(status\.message\) : ''\}<\/p>/);

  const appStyles = fs.readFileSync('src/styles.css', 'utf8');
  assert.match(appStyles, /\.topbar \{ position: sticky;[^}]*-webkit-app-region: drag;/);
  assert.match(appStyles, /\.topbar-right \{ position: absolute;[^}]*top: 8px;[^}]*right: 132px;/);
  assert.match(appStyles, /@media \(min-width: 621px\) \{\s*\.topbar-right \{ top: 40px; right: 12px; \}\s*\.topbar-right \.topbar-profile \{ transform: translateY\(-2px\); \}\s*\}/);
  assert.doesNotMatch(appStyles, /\.topbar-profile \.skin-face-overlay \{ display: none; \}/);
  assert.match(appStyles, /\.friends-call-mute-badges \{[^}]*right: -20px;/);
  assert.match(appStyles, /\.friends-call-control\.is-muted::after \{[^}]*background: #f04e5d;/);
  assert.match(appStyles, /\.window-controls \{ position: absolute;[^}]*top: 0; right: 0;/);
  assert.match(appStyles, /\.window-controls, \.window-controls \* \{ -webkit-app-region: no-drag; \}/);
  assert.match(appStyles, /\.window-controls button \{[^}]*width: 42px; height: 40px;/);
  assert.match(appStyles, /\.window-controls button \{[^}]*background: transparent !important;/);
});

test('macOS packages have isolated output and include the shared Fabric client mod', () => {
  assert.deepEqual(macBuild.mac.target, ['dmg', 'zip']);
  assert.equal(macBuild.directories.output, 'macos-client/release');
  assert.notEqual(macBuild.directories.output, packageJson.build.directories.output);
  assert.equal(macBuild.mac.icon, 'macos-client/westron-client.icns');
  const macIcon = fs.readFileSync(macBuild.mac.icon);
  assert.equal(macIcon.toString('ascii', 0, 4), 'icns');
  assert.equal(macIcon.readUInt32BE(4), macIcon.length);
  let offset = 8;
  while (offset < macIcon.length) {
    const chunkLength = macIcon.readUInt32BE(offset + 4);
    assert.ok(chunkLength >= 8);
    offset += chunkLength;
  }
  assert.equal(offset, macIcon.length);
  assert.deepEqual(packageJson.build.extraResources[1], macBuild.extraResources[0]);
  assert.ok(packageJson.build.files.includes('dist/**/*'));
  assert.ok(packageJson.build.files.includes('electron/**/*'));
  assert.equal(macBuild.extraResources[0].to, `westron-launcher-${packageJson.version}.jar`);
  assert.equal(packageJson.scripts['package:macos'].includes('macos-client/electron-builder.json'), true);
  assert.equal(packageJson.version, '1.0.3');
  const gradleProperties = fs.readFileSync('fabric-mod/gradle.properties', 'utf8');
  assert.match(gradleProperties, new RegExp(`^mod_version=${packageJson.version.replaceAll('.', '\\.')}$`, 'm'));
  assert.equal(packageJson.build.extraResources[1].to, `westron-launcher-${packageJson.version}.jar`);
});

test('macOS build maintains parity with Windows features and resources', () => {
  assert.equal(macBuild.mac.darkModeSupport, true);
  assert.equal(fs.existsSync(`fabric-mod/build/libs/westron-launcher-${packageJson.version}.jar`), true);
  assert.ok(packageJson.scripts['package:macos'].includes('npm run build:mod:macos'));
  assert.ok(packageJson.scripts['package:macos'].includes('npm run build'));
  const mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(mainCode, /function setupApplicationMenu\(\)/);
  assert.match(mainCode, /process\.platform === 'darwin'/);
  assert.match(mainCode, /resolveDefaultMinecraftDir\(appDataDirectory, process\.platform\)/);
  assert.match(mainCode, /\/Library\/Java\/JavaVirtualMachines/);
});

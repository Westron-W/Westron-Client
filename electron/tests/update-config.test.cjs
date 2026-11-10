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
});

test('Windows updater uses GitHub Releases with all required updater assets', () => {
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
  assert.deepEqual(feed, packageJson.build.publish[0]);
  assert.equal(configureUpdateFeed({ setFeedURL: () => assert.fail('macOS must not configure the Windows feed') }, 'darwin'), false);
  const mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(mainCode, /configureUpdateFeed\(autoUpdater, process\.platform\)/);
  const releaseWorkflow = fs.readFileSync('.github/workflows/build-release.yml', 'utf8');
  assert.match(releaseWorkflow, /Westron-Client-Setup-\$\{VERSION\}\.exe\.blockmap/);
  assert.match(releaseWorkflow, /cp release\/latest\.yml/);
  assert.match(releaseWorkflow, /softprops\/action-gh-release/);
  assert.match(releaseWorkflow, /release\/windows\/Westron-Client-Setup-\*\.exe\.blockmap/);
  assert.match(releaseWorkflow, /release\/windows\/latest\.yml/);
  assert.match(releaseWorkflow, /release\/macos\/MacOS-Westron-Client-\*\.dmg/);
  assert.match(releaseWorkflow, /GitHub Release is missing or has unexpected updater\/download assets/);
  assert.match(releaseWorkflow, /release_tag:/);
  assert.match(releaseWorkflow, /startsWith\(github\.event\.head_commit\.message, '\[publish-release\]'\)/);
  assert.match(releaseWorkflow, /Verify published installer assets/);
  assert.match(releaseWorkflow, /gh release view "\$RELEASE_TAG"/);
  assert.doesNotMatch(releaseWorkflow, /gh release delete/);
  assert.match(packageJson.dependencies['electron-updater'], /^\^/);
  assert.equal(packageJson.build.win.icon, 'build/westron-client.ico');
  assert.equal(packageJson.build.nsis.installerIcon, 'build/westron-client.ico');
  assert.equal(packageJson.build.nsis.uninstallerIcon, 'build/westron-client.ico');
  assert.equal(packageJson.build.artifactName, `Westron-Client-Setup-${packageJson.version}.exe`);
  assert.equal(packageJson.build.nsis.installerSidebar, 'build/installer-sidebar.bmp');
  assert.equal(packageJson.build.nsis.uninstallerSidebar, 'build/installer-sidebar.bmp');
  assert.equal(packageJson.build.nsis.installerHeader, 'build/installer-header.bmp');
  assert.equal(fs.existsSync(packageJson.build.nsis.installerSidebar), true);
  assert.equal(fs.existsSync(packageJson.build.nsis.installerHeader), true);
  assert.equal(packageJson.build.nsis.include, undefined);
  assert.equal(fs.existsSync('electron/installer.nsh'), false);
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
  assert.equal(macBuild.extraResources[0].to, `westron-client-skin-${packageJson.version}.jar`);
  assert.equal(packageJson.scripts['package:macos'].includes('macos-client/electron-builder.json'), true);
  assert.equal(packageJson.version, '1.0.3');
  const gradleProperties = fs.readFileSync('fabric-mod/gradle.properties', 'utf8');
  assert.match(gradleProperties, new RegExp(`^mod_version=${packageJson.version.replaceAll('.', '\\.')}$`, 'm'));
  assert.equal(packageJson.build.extraResources[1].to, `westron-client-skin-${packageJson.version}.jar`);
});

test('macOS build maintains parity with Windows features and resources', () => {
  assert.equal(macBuild.mac.darkModeSupport, true);
  assert.equal(fs.existsSync(`fabric-mod/build/libs/westron-client-skin-${packageJson.version}.jar`), true);
  assert.ok(packageJson.scripts['package:macos'].includes('npm run build:mod:macos'));
  assert.ok(packageJson.scripts['package:macos'].includes('npm run build'));
  const mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(mainCode, /function setupApplicationMenu\(\)/);
  assert.match(mainCode, /process\.platform === 'darwin'/);
  assert.match(mainCode, /path\.join\(app\.getPath\('appData'\), 'minecraft'\)/);
  assert.match(mainCode, /\/Library\/Java\/JavaVirtualMachines/);
});

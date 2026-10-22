const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../../package.json');
const lockfile = require('../../package-lock.json');
const macBuild = require('../../macos-client/electron-builder.json');
const fs = require('node:fs');

test('package and lockfile versions are aligned for release metadata', () => {
  assert.equal(packageJson.version, lockfile.version);
  assert.equal(packageJson.version, lockfile.packages[''].version);
  assert.match(fs.readFileSync('electron/main.cjs', 'utf8'), /const DISPLAY_VERSION = '1\.0';/);
});

test('Windows installer publishes update metadata to the HTTPS update path', () => {
  assert.ok(packageJson.build.win.target.some
    ? packageJson.build.win.target.some((target) => target === 'nsis')
    : packageJson.build.win.target === 'nsis');
  assert.ok(packageJson.build.publish.some((provider) =>
    provider.provider === 'generic'
    && provider.url === 'https://westronskin.sytes.net/updates/'
    && provider.channel === 'latest'));
  assert.match(packageJson.dependencies['electron-updater'], /^\^/);
  assert.equal(packageJson.build.win.icon, 'build/westron-client.ico');
  assert.equal(packageJson.build.nsis.installerIcon, 'build/westron-client.ico');
  assert.equal(packageJson.build.nsis.uninstallerIcon, 'build/westron-client.ico');
  assert.equal(packageJson.build.artifactName, 'Westron Client Setup 1.0.exe');
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
  assert.equal(macBuild.extraResources[0].to, 'westron-client-skin-1.0.jar');
  assert.equal(packageJson.scripts['package:macos'].includes('macos-client/electron-builder.json'), true);
  assert.equal(packageJson.version, '1.0.7');
  const gradleProperties = fs.readFileSync('fabric-mod/gradle.properties', 'utf8');
  assert.match(gradleProperties, /^mod_version=1\.0$/m);
  assert.equal(packageJson.build.extraResources[1].to, 'westron-client-skin-1.0.jar');
});

test('macOS build maintains parity with Windows features and resources', () => {
  assert.equal(macBuild.mac.darkModeSupport, true);
  assert.equal(fs.existsSync('fabric-mod/build/libs/westron-client-skin-1.0.jar'), true);
  assert.ok(packageJson.scripts['package:macos'].includes('npm run build:mod:macos'));
  assert.ok(packageJson.scripts['package:macos'].includes('npm run build'));
  const mainCode = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(mainCode, /function setupApplicationMenu\(\)/);
  assert.match(mainCode, /process\.platform === 'darwin'/);
  assert.match(mainCode, /path\.join\(app\.getPath\('appData'\), 'minecraft'\)/);
  assert.match(mainCode, /\/Library\/Java\/JavaVirtualMachines/);
});

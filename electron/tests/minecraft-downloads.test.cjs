const test = require('node:test');
const assert = require('node:assert/strict');
const { addVerifiedMavenMirrors, formatInstallError } = require('../minecraft-downloads.cjs');

const originalUrl =
  'https://maven.fabricmc.net/org/ow2/asm/asm-analysis/9.10.1/asm-analysis-9.10.1.jar';
const mirrorUrl =
  'https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.10.1/asm-analysis-9.10.1.jar';
const sha1 = '8d49f14d51f632cb1d87c88d1ceaf50db0d8af1b';

test('adds a verified Maven Central mirror for the affected ASM artifact', () => {
  const action = { kind: 'download-file', url: originalUrl, target: 'asm-analysis.jar' };
  const plan = { actions: [action], totalActions: 1 };

  const mirrored = addVerifiedMavenMirrors(plan);

  assert.deepEqual(mirrored.actions[0], {
    ...action,
    url: [mirrorUrl, originalUrl],
    expectedSha1: sha1,
    expectedSize: 35140,
  });
  assert.equal(mirrored.actions[0] === action, false);
  assert.equal(plan.actions[0], action);
});

test('preserves existing integrity metadata and avoids duplicate mirror URLs', () => {
  const action = {
    kind: 'download-file',
    url: [originalUrl, mirrorUrl],
    target: 'asm-analysis.jar',
    expectedSha1: 'existing-sha1',
    expectedSize: 42,
  };

  const mirrored = addVerifiedMavenMirrors({ actions: [action] });

  assert.deepEqual(mirrored.actions[0].url, [mirrorUrl, originalUrl]);
  assert.equal(mirrored.actions[0].expectedSha1, 'existing-sha1');
  assert.equal(mirrored.actions[0].expectedSize, 42);
});

test('does not modify unrelated actions or plans', () => {
  const action = {
    kind: 'download-file',
    url: 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/loader.jar',
    target: 'fabric-loader.jar',
  };
  const plan = { actions: [action] };

  assert.equal(addVerifiedMavenMirrors(plan), plan);
});

test('includes the underlying mirror failure in actionable download errors', () => {
  const cause = new AggregateError([
    new Error('HTTP 503 for primary'),
    new Error('Network timeout for mirror'),
  ]);
  const error = formatInstallError(new Error('All 2 mirror URLs failed for asm-analysis.jar', { cause }));

  assert.match(error.message, /HTTP 503 for primary/);
  assert.match(error.message, /Network timeout for mirror/);
  assert.match(error.message, /İnternet bağlantınızı/);
  assert.equal(error.cause.cause, cause);
});

test('leaves non-download errors unchanged', () => {
  const error = new Error('Invalid launcher options.');

  assert.equal(formatInstallError(error), error);
});

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { canGrantAudioMediaPermission } = require('../media-permissions.cjs');

test('grants microphone permission only to the launcher renderer', () => {
  const productionRendererUrl = pathToFileURL(path.resolve('dist', 'index.html')).href;
  const request = {
    permission: 'media',
    mediaTypes: ['audio'],
    isDevelopment: false,
    productionRendererUrl,
  };

  assert.equal(canGrantAudioMediaPermission({ ...request, url: productionRendererUrl }), true);
  assert.equal(canGrantAudioMediaPermission({ ...request, url: `${productionRendererUrl}?other` }), false);
  assert.equal(canGrantAudioMediaPermission({ ...request, url: 'https://example.test/' }), false);
  assert.equal(canGrantAudioMediaPermission({
    ...request,
    url: productionRendererUrl,
    mediaTypes: ['audio', 'video'],
  }), false);
  assert.equal(canGrantAudioMediaPermission({
    ...request,
    url: productionRendererUrl,
    permission: 'notifications',
  }), false);
});

test('development microphone permission is limited to the local Vite origin', () => {
  const request = {
    permission: 'media',
    mediaTypes: ['audio'],
    isDevelopment: true,
    productionRendererUrl: 'file:///launcher/index.html',
  };

  assert.equal(canGrantAudioMediaPermission({ ...request, url: 'http://localhost:5173/' }), true);
  assert.equal(canGrantAudioMediaPermission({ ...request, url: 'http://localhost:5174/' }), false);
  assert.equal(canGrantAudioMediaPermission({ ...request, url: 'http://127.0.0.1:5173/' }), false);
});

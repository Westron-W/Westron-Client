const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const {
  WESTRON_API_PATHS,
  WESTRON_IPC_CHANNELS,
  createWestronAuthRefresher,
  createWestronApiClient,
  registerWestronIpcHandlers,
} = require('../westron-api.cjs');
const { writeLocalSkinIdentity } = require('../westron-skin-identity.cjs');

test('clears a rejected expired refresh token and requests a fresh sign-in', async () => {
  let storedCredentials = { accessToken: 'expired-access', refreshToken: 'expired-refresh' };
  let clearCount = 0;
  const refreshCredentials = createWestronAuthRefresher({
    readCredentials: async () => storedCredentials,
    refresh: async () => {
      const error = new Error('Yenileme belirteci geçersiz veya süresi dolmuş.');
      error.status = 401;
      error.code = 'invalid_refresh_token';
      throw error;
    },
    saveCredentials: async (credentials) => { storedCredentials = credentials; },
    clearCredentials: async () => {
      clearCount += 1;
      storedCredentials = null;
    },
  });

  await assert.rejects(
    refreshCredentials({ accessToken: 'expired-access', refreshToken: 'expired-refresh' }),
    /Westron oturumunuz sona erdi\. Skin ve pelerin yüklemek için yeniden giriş yapın\./,
  );
  assert.equal(clearCount, 1);
  assert.equal(storedCredentials, null);
});

test('deduplicates concurrent refreshes and persists the rotated token once', async () => {
  let storedCredentials = { accessToken: 'old-access', refreshToken: 'old-refresh' };
  let refreshCount = 0;
  let saveCount = 0;
  const refreshCredentials = createWestronAuthRefresher({
    readCredentials: async () => storedCredentials,
    refresh: async () => {
      refreshCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { accessToken: 'new-access', refreshToken: 'new-refresh' };
    },
    saveCredentials: async (credentials) => {
      saveCount += 1;
      storedCredentials = credentials;
    },
    clearCredentials: async () => { storedCredentials = null; },
  });
  const staleCredentials = { accessToken: 'old-access', refreshToken: 'old-refresh' };

  const results = await Promise.all([
    refreshCredentials(staleCredentials),
    refreshCredentials(staleCredentials),
  ]);
  assert.equal(refreshCount, 1);
  assert.equal(saveCount, 1);
  assert.deepEqual(results, [storedCredentials, storedCredentials]);
});

test('uses a token already rotated by another launcher request instead of replaying the old token', async () => {
  const storedCredentials = { accessToken: 'new-access', refreshToken: 'new-refresh' };
  let refreshCount = 0;
  const refreshCredentials = createWestronAuthRefresher({
    readCredentials: async () => storedCredentials,
    refresh: async () => { refreshCount += 1; },
    saveCredentials: async () => {},
    clearCredentials: async () => {},
  });

  assert.equal(
    await refreshCredentials({ accessToken: 'old-access', refreshToken: 'old-refresh' }),
    storedCredentials,
  );
  assert.equal(refreshCount, 0);
});

test('launcher maps its Minecraft username to the signed-in Westron profile and clears stale identity', async (context) => {
  const minecraftDir = await mkdtemp(path.join(os.tmpdir(), 'westron-skin-identity-'));
  context.after(() => rm(minecraftDir, { recursive: true, force: true }));

  await writeLocalSkinIdentity(minecraftDir, 'OfflinePlayer', 'Westron_W');
  const identityPath = path.join(minecraftDir, 'westron-skins', 'local-player.properties');
  assert.equal(await readFile(identityPath, 'utf8'),
    'minecraftUsername=OfflinePlayer\nwestronUsername=Westron_W\n');

  await writeLocalSkinIdentity(minecraftDir, 'OfflinePlayer', null);
  await assert.rejects(readFile(identityPath, 'utf8'), { code: 'ENOENT' });
});

test('launcher can publish a linked Minecraft username to the authenticated Westron profile', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(JSON.stringify({ message: 'Minecraft adı bağlandı.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await apiClient.setMinecraftProfile('MinecraftNick', 'access-token');

  assert.equal(result.message, 'Minecraft adı bağlandı.');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.minecraftProfile}`);
  assert.equal(requests[0].init.method, 'PUT');
  assert.equal(requests[0].init.headers.get('content-type'), 'application/json');
  assert.equal(requests[0].init.headers.get('authorization'), 'Bearer access-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), { username: 'MinecraftNick' });
});

test('launcher IPC resend channel forwards one POST to the API route without duplicating /api/v1', async () => {
  const registeredHandlers = new Map();
  const requestLog = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requestLog.push({ url: url.toString(), init });
      return new Response(JSON.stringify({
        message: 'Adres kayıtlı ve doğrulanmamışsa yeni bir doğrulama e-postası gönderildi.',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  registerWestronIpcHandlers({
    handle(channel, listener) {
      registeredHandlers.set(channel, listener);
    },
  }, {
    getAccount: async () => null,
    register: async () => {},
    login: async () => {},
    verifyEmail: async () => {},
    resendVerification: async ({ email }) => {
      const result = await apiClient.resendVerification({ email });
      return result.message;
    },
    requestPasswordReset: async () => {},
    resetPassword: async () => {},
    profile: async () => {},
    uploadSkin: async () => {},
    deleteSkin: async () => 'Skin kaldırıldı.',
    logout: async () => {},
  });

  const channelHandler = registeredHandlers.get(WESTRON_IPC_CHANNELS.resendVerification);
  assert.equal(typeof channelHandler, 'function');
  const responseText = await channelHandler({}, { email: 'pending@example.test' });
  assert.match(responseText, /doğrulama e-postası gönderildi/i);
  assert.equal(requestLog.length, 1);
  assert.equal(requestLog[0].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.resendVerification}`);
  assert.equal(requestLog[0].init.method, 'POST');
  assert.equal(requestLog[0].init.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(requestLog[0].init.body), { email: 'pending@example.test' });
  const deleteSkinHandler = registeredHandlers.get(WESTRON_IPC_CHANNELS.deleteSkin);
  assert.equal(typeof deleteSkinHandler, 'function');
  assert.equal(await deleteSkinHandler({}), 'Skin kaldırıldı.');

  const preload = await readFile(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.match(preload, /resendWestronVerification:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\(WESTRON_IPC_CHANNELS\.resendVerification,\s*input\)/);
  assert.doesNotMatch(preload, /require\(['"]\.\/|require\(['"]\.\.\/|require\(['"]electron\/remote/);

  const calls = [];
  let exposedBridge;
  const sandboxRequire = (moduleName) => {
    if (moduleName !== 'electron') throw new Error(`Sandboxed preload cannot load ${moduleName}`);
    return {
      contextBridge: { exposeInMainWorld: (_key, bridge) => { exposedBridge = bridge; } },
      ipcRenderer: {
        invoke: async (...args) => {
          calls.push(args);
          return 'IPC response';
        },
        on() {},
        removeListener() {},
      },
    };
  };
  vm.runInNewContext(preload, { require: sandboxRequire });
  assert.equal(await exposedBridge.resendWestronVerification({ email: 'pending@example.test' }), 'IPC response');
  assert.equal(calls[0][0], WESTRON_IPC_CHANNELS.resendVerification);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { email: 'pending@example.test' });
  await exposedBridge.deleteWestronSkin();
  assert.equal(calls[1][0], WESTRON_IPC_CHANNELS.deleteSkin);
});

test('launcher explains missing API routes without confusing them with endpoint-specific 404 errors', async () => {
  for (const [status, payload, expectedMessage, expectedCode] of [
    [
      404,
      { error: { code: 'not_found', message: 'Not Found - /api/v1/me/cape' } },
      'Westron Skin API uç noktası sunucuda bulunamadı (404). API sunucusu güncel skin-api koduyla yeniden dağıtılmalı.',
      'route_not_found',
    ],
    [
      404,
      { error: { code: 'cape_not_found', message: 'Pelerin bulunamadı.' } },
      'Pelerin bulunamadı.',
      'cape_not_found',
    ],
    [
      503,
      { error: { code: 'email_delivery_failed', message: 'E-posta gönderilemedi. Daha sonra yeniden deneyin.' } },
      'E-posta gönderilemedi. Daha sonra yeniden deneyin.',
      'email_delivery_failed',
    ],
  ]) {
    const apiClient = createWestronApiClient({
      baseUrl: 'https://westronskin.sytes.net',
      fetchImpl: async () => new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await assert.rejects(apiClient.resendVerification({ email: 'pending@example.test' }), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message, expectedMessage);
      assert.equal(error.code, expectedCode);
      return true;
    });
  }
});

test('launcher recognizes Fastify route-not-found responses', async () => {
  const apiClient = createWestronApiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      message: 'Route POST:/api/v1/me/cape not found',
      error: 'Not Found',
      statusCode: 404,
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(apiClient.request('/api/v1/me/cape', { method: 'POST' }), (error) => {
    assert.equal(error.code, 'route_not_found');
    assert.match(error.message, /API sunucusu güncel skin-api koduyla yeniden dağıtılmalı/);
    return true;
  });
});

test('launcher explains reverse-proxy gateway failures as API availability issues', async () => {
  const apiClient = createWestronApiClient({
    fetchImpl: async () => new Response(
      '<html><body><h1>502 Bad Gateway</h1></body></html>',
      { status: 502, headers: { 'content-type': 'text/html' } },
    ),
  });
  await assert.rejects(apiClient.getProfile('access-token'), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, 'api_unavailable');
    assert.match(error.message, /VDS'de API container'ının çalıştığını ve proxy ağına bağlı olduğunu kontrol edin/);
    return true;
  });
});

test('Westron API requests allow a validated long timeout for update uploads', async () => {
  const originalTimeout = AbortSignal.timeout;
  let timeoutMs;
  AbortSignal.timeout = (value) => {
    timeoutMs = value;
    return new AbortController().signal;
  };
  try {
    const apiClient = createWestronApiClient({
      fetchImpl: async () => new Response('ok'),
    });

    test('multipart uploads leave Content-Type boundary generation to fetch', async () => {
      let capturedOptions;
      const apiClient = createWestronApiClient({
        fetchImpl: async (_url, options) => {
          capturedOptions = options;
          return new Response(JSON.stringify({ uploaded: true }), {
            headers: { 'content-type': 'application/json' },
          });
        },
      });
      const form = new FormData();
      form.append('cape', new Blob(['png']), 'cape.png');

      await apiClient.request('/api/v1/me/cape', {
        method: 'POST',
        body: form,
        accessToken: 'test-access-token',
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      assert.equal(capturedOptions.headers.get('content-type'), null);
      assert.equal(capturedOptions.body, form);
    });
    await apiClient.request('/api/v1/admin/updates/installer.exe', {
      method: 'POST',
      body: Buffer.from('installer'),
      timeoutMs: 30 * 60 * 1000,
    });
    assert.equal(timeoutMs, 30 * 60 * 1000);
    await assert.rejects(
      apiClient.request('/api/v1/test', { timeoutMs: 0 }),
      /timeout must be a positive integer/,
    );
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

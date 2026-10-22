const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const {
  WESTRON_API_PATHS,
  WESTRON_IPC_CHANNELS,
  createWestronApiClient,
  registerWestronIpcHandlers,
} = require('../westron-api.cjs');
const { writeLocalSkinIdentity } = require('../westron-skin-identity.cjs');

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
});

test('launcher keeps HTTP 404 route mismatch distinct from backend SMTP 503 errors', async () => {
  for (const [status, message] of [
    [404, 'Not Found - /api/v1/auth/resend-verification'],
    [503, 'E-posta gönderilemedi. Daha sonra yeniden deneyin.'],
  ]) {
    const apiClient = createWestronApiClient({
      baseUrl: 'https://westronskin.sytes.net',
      fetchImpl: async () => new Response(JSON.stringify({
        error: { code: status === 503 ? 'email_delivery_failed' : 'not_found', message },
      }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await assert.rejects(apiClient.resendVerification({ email: 'pending@example.test' }), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message, message);
      return true;
    });
  }
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

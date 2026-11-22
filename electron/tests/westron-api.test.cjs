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
const { createMinecraftSkinLookup } = require('../minecraft-skin.cjs');

test('resolves and caches a Minecraft skin texture URL without trusting response hosts', async () => {
  const textureUrl = `https://textures.minecraft.net/texture/${'a'.repeat(64)}`;
  const textureValue = Buffer.from(JSON.stringify({
    textures: { SKIN: { url: textureUrl } },
  })).toString('base64');
  const responses = [
    new Response(JSON.stringify({ id: 'b'.repeat(32) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    new Response(JSON.stringify({ properties: [{ name: 'textures', value: textureValue }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ];
  let fetchCount = 0;
  const lookup = createMinecraftSkinLookup({
    fetchImpl: async () => {
      fetchCount += 1;
      return responses.shift();
    },
  });
  assert.equal(await lookup('MinecraftNick'), textureUrl);
  assert.equal(await lookup('minecraftnick'), textureUrl);
  assert.equal(fetchCount, 2);

  const invalidHost = createMinecraftSkinLookup({
    fetchImpl: async (url) => new Response(JSON.stringify(
      url.includes('api.mojang.com')
        ? { id: 'c'.repeat(32) }
        : { properties: [{ name: 'textures', value: Buffer.from(JSON.stringify({
          textures: { SKIN: { url: 'https://example.com/skin.png' } },
        })).toString('base64') }] },
    ), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(await invalidHost('AnotherNick'), null);
});

test('loads public friend profiles without browser-side authentication', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(JSON.stringify({ username: 'Friend_Name', skin: null, cape: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const profile = await apiClient.getPublicProfile('Friend_Name');

  assert.equal(profile.username, 'Friend_Name');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://westronskin.sytes.net/api/v1/profiles/Friend_Name');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.has('authorization'), false);
});

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
    uploadCape: async () => {},
    deleteCape: async () => {},
    uploadElytra: async () => {},
    deleteElytra: async () => {},
    logout: async () => {},
    listFriends: async () => ({}),
    getFriendSkinUrl: async () => null,
    searchFriends: async () => [],
    listGroups: async () => [],
    createGroup: async () => ({}),
    renameGroup: async () => ({}),
    deleteGroup: async () => ({ deleted: true }),
    removeGroupMember: async () => ({}),
    listGroupConversation: async () => [{ messageId: 'group-message' }],
    sendGroupMessage: async () => ({}),
    getGroupMessagePhoto: async () => '',
    sendGroupPhoto: async () => ({ cancelled: true }),
    sendFriendRequest: async () => ({}),
    respondFriendRequest: async () => ({}),
    cancelFriendRequest: async () => ({}),
    removeFriend: async () => ({}),
    updatePresence: async () => ({}),
    sendEphemeralMessage: async () => ({}),
    listEphemeralMessages: async () => [],
    consumeEphemeralMessage: async () => ({}),
    listConversation: async () => [],
    getMessagePhoto: async () => '',
    getVoiceCallIceServers: async () => ({}),
    sendVoiceCallSignal: async () => ({}),
    consumeVoiceCallSignals: async () => [],
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
  const listGroupConversationHandler = registeredHandlers.get(WESTRON_IPC_CHANNELS.listGroupConversation);
  assert.equal(typeof listGroupConversationHandler, 'function');
  assert.deepEqual(await listGroupConversationHandler({}, { groupId: 'group-id' }), [
    { messageId: 'group-message' },
  ]);
  assert.equal(WESTRON_IPC_CHANNELS.listGroupConversation, 'app:westron-list-group-conversation');
  const deleteGroupHandler = registeredHandlers.get(WESTRON_IPC_CHANNELS.deleteGroup);
  assert.equal(typeof deleteGroupHandler, 'function');
  assert.deepEqual(await deleteGroupHandler({}, { groupId: 'group-id' }), { deleted: true });

  const preload = await readFile(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.match(preload, /resendWestronVerification:\s*\(input\)\s*=>\s*invokeWestron\(WESTRON_IPC_CHANNELS\.resendVerification,\s*input\)/);
  assert.match(preload, /getWestronFriendSkinUrl:\s*\(input\)\s*=>\s*invokeWestron\(WESTRON_IPC_CHANNELS\.getFriendSkinUrl,\s*input\)/);
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
          if (args[0] === WESTRON_IPC_CHANNELS.consumeVoiceCallSignals) {
            throw new Error(`Error invoking remote method '${args[0]}': Error: Westron Skin API uç noktası sunucuda bulunamadı (404)`);
          }
          return 'IPC response';
        },
        on() {},
        removeListener() {},
      },
    };
  };
  vm.runInNewContext(preload, { require: sandboxRequire, process: { platform: 'win32' } });
  assert.equal(exposedBridge.platform, 'win32');
  assert.equal(await exposedBridge.resendWestronVerification({ email: 'pending@example.test' }), 'IPC response');
  assert.equal(calls[0][0], WESTRON_IPC_CHANNELS.resendVerification);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { email: 'pending@example.test' });
  await exposedBridge.deleteWestronSkin();
  assert.equal(calls[1][0], WESTRON_IPC_CHANNELS.deleteSkin);
  await exposedBridge.deleteWestronGroup({ groupId: 'group-id' });
  assert.equal(calls[2][0], WESTRON_IPC_CHANNELS.deleteGroup);
  await exposedBridge.listWestronFriends();
  assert.equal(calls[3][0], WESTRON_IPC_CHANNELS.listFriends);
  await assert.rejects(exposedBridge.consumeWestronVoiceCallSignals(), {
    message: 'Westron Skin API uç noktası sunucuda bulunamadı (404)',
  });
  assert.equal(calls[4][0], WESTRON_IPC_CHANNELS.consumeVoiceCallSignals);
  assert.equal(await exposedBridge.requestPasswordReset({ email: 'account@example.test' }), 'IPC response');
  assert.equal(calls[5][0], WESTRON_IPC_CHANNELS.requestPasswordReset);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[5][1])), { email: 'account@example.test' });
  assert.equal(await exposedBridge.resetPassword({
    email: 'account@example.test',
    token: '1234567890123456789012345678901234567890',
    newPassword: 'a-secure-new-password',
  }), 'IPC response');
  assert.equal(calls[6][0], WESTRON_IPC_CHANNELS.resetPassword);
});

test('social API calls stay authenticated and use the friends endpoint contract', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const token = 'westron-access-token';

  await apiClient.listFriends(token);
  await apiClient.sendFriendRequest('FriendName', token);
  await apiClient.respondFriendRequest('request-id', true, token);
  await apiClient.cancelFriendRequest('request-id', token);
  await apiClient.removeFriend('friend-id', token);
  await apiClient.updatePresence(true, token);
  await apiClient.sendEphemeralMessage('friend-id', 'Hello', token);
  await apiClient.listEphemeralMessages(token);
  await apiClient.consumeEphemeralMessage('message-id', token);
  await apiClient.getVoiceCallIceServers(token);
  await apiClient.sendVoiceCallSignal({
    recipientUserId: 'friend-id',
    callId: 'call-id',
    type: 'offer',
    sdp: 'v=0',
  }, token);
  await apiClient.consumeVoiceCallSignals(token);

  assert.equal(requests.length, 12);
  assert.ok(requests.every(({ init }) => init.headers.get('authorization') === `Bearer ${token}`));
  assert.deepEqual(requests.map(({ url, init }) => [new URL(url).pathname, init.method || 'GET']), [
    ['/api/v1/friends', 'GET'],
    ['/api/v1/friends/requests', 'POST'],
    ['/api/v1/friends/requests/request-id/respond', 'POST'],
    ['/api/v1/friends/requests/request-id', 'DELETE'],
    ['/api/v1/friends/friend-id', 'DELETE'],
    ['/api/v1/presence', 'POST'],
    ['/api/v1/friends/messages', 'POST'],
    ['/api/v1/friends/messages/inbox', 'GET'],
    ['/api/v1/friends/messages/message-id/consume', 'POST'],
    ['/api/v1/friends/calls/ice-servers', 'GET'],
    ['/api/v1/friends/calls/signals', 'POST'],
    ['/api/v1/friends/calls/signals', 'GET'],
  ]);
  assert.deepEqual(JSON.parse(requests[6].init.body), { recipientUserId: 'friend-id', body: 'Hello' });
  assert.deepEqual(JSON.parse(requests[10].init.body), {
    recipientUserId: 'friend-id',
    callId: 'call-id',
    type: 'offer',
    sdp: 'v=0',
  });
});

test('downloads an authenticated one-time photo as base64 for renderer IPC', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    },
  });
  const messageId = '2e3ccf04-4d60-4f66-9c70-152a4e7b9d1c';
  const result = await apiClient.getMessagePhoto(messageId, 'westron-access-token');
  assert.equal(result, Buffer.from([137, 80, 78, 71]).toString('base64'));
  assert.equal(requests[0].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.friendMessagePhoto(messageId)}`);
  assert.equal(requests[0].init.headers.get('authorization'), 'Bearer westron-access-token');
});

test('uploads and downloads authenticated group photos through the group message routes', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ messageId: 'message-id', kind: 'photo' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    },
  });
  const groupId = '2e3ccf04-4d60-4f66-9c70-152a4e7b9d1c';
  const messageId = '6506a0dd-75d0-4a2d-bde2-d9e3cae50409';
  const token = 'westron-access-token';
  const uploaded = await apiClient.sendGroupPhotoMessage(groupId, 'photo.jpg', Buffer.from('photo-bytes'), token);
  const downloaded = await apiClient.getGroupMessagePhoto(groupId, messageId, token);

  assert.deepEqual(uploaded, { messageId: 'message-id', kind: 'photo' });
  assert.equal(downloaded, Buffer.from([137, 80, 78, 71]).toString('base64'));
  assert.equal(requests[0].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.friendGroupPhotoMessage(groupId)}`);
  assert.equal(requests[0].init.headers.get('authorization'), `Bearer ${token}`);
  const photo = requests[0].init.body.get('photo');
  assert.equal(photo.type, 'image/jpeg');
  assert.equal(photo.name, 'photo.jpg');
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString(), 'photo-bytes');
  assert.equal(requests[1].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.friendGroupMessagePhoto(groupId, messageId)}`);
  assert.equal(requests[1].init.headers.get('authorization'), `Bearer ${token}`);
});

test('deletes an authenticated friend group through its group resource route', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const groupId = '2e3ccf04-4d60-4f66-9c70-152a4e7b9d1c';
  const token = 'westron-access-token';

  assert.deepEqual(await apiClient.deleteGroup(groupId, token), { deleted: true });
  assert.equal(requests[0].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.friendGroup(groupId)}`);
  assert.equal(requests[0].init.method, 'DELETE');
  assert.equal(requests[0].init.headers.get('authorization'), `Bearer ${token}`);
});

test('recalls an authenticated group message through its group-scoped route', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(JSON.stringify({ recalled: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const groupId = '2e3ccf04-4d60-4f66-9c70-152a4e7b9d1c';
  const messageId = '6506a0dd-75d0-4a2d-bde2-d9e3cae50409';
  const token = 'westron-access-token';

  assert.deepEqual(await apiClient.recallGroupMessage(groupId, messageId, token), { recalled: true });
  assert.equal(requests[0].url, `https://westronskin.sytes.net${WESTRON_API_PATHS.recallFriendGroupMessage(groupId, messageId)}`);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.get('authorization'), `Bearer ${token}`);
});

test('message recall retries the canonical API origin when the configured alias returns 405', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    baseUrl: 'https://westronclient.myvnc.com',
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), init });
      return new Response(JSON.stringify(
        requests.length === 1 ? { error: { code: 'method_not_allowed' } } : { recalled: true },
      ), {
        status: requests.length === 1 ? 405 : 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const messageId = '2e3ccf04-4d60-4f66-9c70-152a4e7b9d1c';
  const result = await apiClient.recallEphemeralMessage(messageId, 'token');

  assert.deepEqual(result, { recalled: true });
  assert.deepEqual(requests.map(({ url, init }) => [new URL(url).origin, new URL(url).pathname, init.method]), [
    ['https://westronclient.myvnc.com', `/api/v1/friends/messages/${messageId}/recall`, 'POST'],
    ['https://westronskin.sytes.net', `/api/v1/friends/messages/${messageId}/recall`, 'POST'],
  ]);
});

test('canonical API requests do not fall back to the obsolete origin', async () => {
  const requests = [];
  const apiClient = createWestronApiClient({
    fetchImpl: async (url) => {
      requests.push(url.toString());
      return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await assert.rejects(apiClient.recallEphemeralMessage(
    '2e3ccf04-4d60-4f66-9c70-152a4e7b9d1c',
    'token',
  ), { status: 405, code: 'method_not_allowed' });
  assert.deepEqual(requests.map((url) => new URL(url).origin), ['https://westronskin.sytes.net']);
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

test('Westron API requests can disable timeouts for large update uploads', async () => {
  const originalTimeout = AbortSignal.timeout;
  let timeoutMs;
  let requestOptions;
  let requestUrl;
  AbortSignal.timeout = (value) => {
    timeoutMs = value;
    return new AbortController().signal;
  };
  try {
    const apiClient = createWestronApiClient({
      fetchImpl: async (url, options) => {
        requestUrl = url.toString();
        requestOptions = options;
        return new Response('ok');
      },
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
    await apiClient.updateAsset('installer.exe', {
      method: 'POST',
      body: Buffer.from('large installer'),
      timeoutMs: null,
    });
    assert.equal(requestUrl, `https://westronskin.sytes.net${WESTRON_API_PATHS.updateAsset('installer.exe')}`);
    assert.equal(requestOptions.signal, undefined);
    assert.equal(timeoutMs, 30 * 60 * 1000);
    await assert.rejects(
      apiClient.request('/api/v1/test', { timeoutMs: 0 }),
      /timeout must be a positive integer/,
    );
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

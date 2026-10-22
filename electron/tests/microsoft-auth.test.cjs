const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMicrosoftAuthService,
  validateMicrosoftAuthorizationUrl,
} = require('../microsoft-auth.cjs');

const clientId = '12345678-1234-1234-1234-123456789abc';
const authorizationUrl = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?state=state123&code_challenge=challenge123&code_challenge_method=S256';
const session = {
  minecraft: {
    accessToken: 'minecraft-access-token',
    username: 'WestronPlayer',
    uuid: '00112233-4455-6677-8899-aabbccddeeff',
  },
  microsoft: { refreshToken: 'microsoft-refresh-token' },
};

function createService(overrides = {}) {
  let storedAuth = null;
  const calls = {};
  const kit = {
    asAzureClientId: (value) => value,
    asMicrosoftRefreshToken: (value) => value,
    toOnlineAuth: (value) => ({ mode: 'ONLINE', value }),
    auth: {
      authorizationCode: {
        run: async (options) => {
          calls.authorizationOptions = options;
          if (overrides.authorizationCodeRun) return overrides.authorizationCodeRun(options);
          await options.onOpenBrowser(authorizationUrl);
          return session;
        },
      },
      refresh: async (token, options) => {
        calls.refresh = { token, options };
        return session;
      },
      profile: {
        read: async ({ accessToken }) => {
          calls.profileToken = accessToken;
          if (overrides.profileRead) return overrides.profileRead({ accessToken });
          return {
            username: session.minecraft.username,
            uuid: session.minecraft.uuid,
            skins: [{ state: 'ACTIVE', url: 'https://textures.minecraft.net/skin.png' }],
          };
        },
      },
    },
  };
  const minecraftKitModule = {
    kit,
    asAzureClientId: kit.asAzureClientId,
    asMicrosoftRefreshToken: kit.asMicrosoftRefreshToken,
    toOnlineAuth: kit.toOnlineAuth,
  };
  const service = createMicrosoftAuthService({
    getMinecraftKit: async () => minecraftKitModule,
    clientIdValue: clientId,
    openExternal: async (url) => { calls.openedUrl = url; },
    loadStoredAuth: async () => storedAuth,
    saveStoredAuth: async (value) => { storedAuth = value; },
    clearStoredAuth: async () => { storedAuth = null; },
    ...overrides,
  });
  return {
    service,
    calls,
    getStoredAuth: () => storedAuth,
  };
}

test('accepts only HTTPS Microsoft authorization URLs with state and PKCE', () => {
  assert.equal(validateMicrosoftAuthorizationUrl(authorizationUrl), authorizationUrl);
  assert.throws(() => validateMicrosoftAuthorizationUrl(
    authorizationUrl.replace('https:', 'http:'),
  ), /güvenli biçimde doğrulanamadı/);
  assert.throws(() => validateMicrosoftAuthorizationUrl(
    authorizationUrl.replace('login.microsoftonline.com', 'attacker.example'),
  ), /güvenli biçimde doğrulanamadı/);
  assert.throws(() => validateMicrosoftAuthorizationUrl(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  ), /güvenli biçimde doğrulanamadı/);
});

test('sign-in verifies the Minecraft profile and returns no credentials', async () => {
  const { service, calls, getStoredAuth } = createService();
  const account = await service.signIn();

  assert.deepEqual(account, {
    username: 'WestronPlayer',
    uuid: session.minecraft.uuid,
    skinUrl: 'https://textures.minecraft.net/skin.png',
  });
  assert.equal(calls.openedUrl, authorizationUrl);
  assert.equal(calls.authorizationOptions.clientId, clientId);
  assert.equal(calls.profileToken, 'minecraft-access-token');
  assert.deepEqual(getStoredAuth(), {
    refreshToken: 'microsoft-refresh-token',
    account,
  });
  assert.equal(JSON.stringify(account).includes('token'), false);
});

test('launch refreshes the Microsoft session and supplies verified online auth', async () => {
  const { service, calls } = createService({
    loadStoredAuth: async () => ({
      refreshToken: 'old-refresh-token',
      account: { username: 'OldName', uuid: session.minecraft.uuid, skinUrl: null },
    }),
  });
  const result = await service.getLaunchSession();

  assert.deepEqual(calls.refresh, {
    token: 'old-refresh-token',
    options: { clientId },
  });
  assert.equal(result.account.username, 'WestronPlayer');
  assert.deepEqual(result.auth, { mode: 'ONLINE', value: session });
});

test('does not start OAuth when Microsoft Client ID is missing', async () => {
  const { service } = createService({ clientIdValue: '' });
  await assert.rejects(service.signIn(), /MINECRAFT_KIT_MSA_CLIENT_ID/);
});

test('cancels an active loopback OAuth flow and reports cancellation in Turkish', async () => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const { service, calls } = createService({
    authorizationCodeRun: ({ signal }) => new Promise((_resolve, reject) => {
      markStarted();
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.code = 'AUTH_CANCELLED';
        reject(error);
      }, { once: true });
    }),
  });

  const signIn = service.signIn();
  await started;
  assert.equal(calls.authorizationOptions.signal.aborted, false);
  assert.equal(service.cancelSignIn(), 'Microsoft giriş işlemi iptal ediliyor.');
  await assert.rejects(signIn, /Microsoft ile giriş iptal edildi/);
  assert.equal(calls.authorizationOptions.signal.aborted, true);
});

test('reports Microsoft consent denial clearly', async () => {
  const { service } = createService({
    authorizationCodeRun: async () => {
      const error = new Error('declined');
      error.code = 'AUTH_AUTHORIZATION_CODE_DECLINED';
      throw error;
    },
  });

  await assert.rejects(service.signIn(), /giriş isteği reddedildi/i);
});

test('reports missing Java Edition ownership without persisting credentials', async () => {
  const { service, getStoredAuth } = createService({
    authorizationCodeRun: async (options) => {
      await options.onOpenBrowser(authorizationUrl);
      const error = new Error('no ownership');
      error.code = 'AUTH_NO_GAME_OWNERSHIP';
      throw error;
    },
  });

  await assert.rejects(service.signIn(), /Minecraft: Java Edition lisansı veya oyun profili bulunamadı/);
  assert.equal(getStoredAuth(), null);
});

test('rejects a Minecraft profile that does not match the authenticated session', async () => {
  const { service, getStoredAuth } = createService({
    profileRead: async () => ({
      username: 'DifferentPlayer',
      uuid: session.minecraft.uuid,
      skins: [],
    }),
  });

  await assert.rejects(service.signIn(), /Minecraft profili doğrulanamadı/);
  assert.equal(getStoredAuth(), null);
});

test('reports network failures without exposing provider error details', async () => {
  const { service } = createService({
    authorizationCodeRun: async () => {
      const error = new Error('fetch failed');
      error.cause = Object.assign(new Error('socket unavailable'), { code: 'ENETUNREACH' });
      throw error;
    },
  });

  await assert.rejects(service.signIn(), /sunucularına ulaşılamadı/);
});

test('reports Minecraft app-registration approval errors distinctly', async () => {
  const { service } = createService({
    authorizationCodeRun: async () => {
      const error = new Error('Minecraft Services request failed');
      error.code = 'AUTH_MINECRAFT_FAILED';
      error.context = { reason: 'invalid_app_registration' };
      throw error;
    },
  });

  await assert.rejects(service.signIn(), /Minecraft Services bu uygulamayı henüz onaylamamış/);
});

test('does not claim sign-in succeeded when secure token persistence fails', async () => {
  const { service } = createService({
    saveStoredAuth: async () => { throw new Error('OS secure storage unavailable'); },
  });

  await assert.rejects(service.signIn(), /güvenli deposuna kaydedilemedi/);
});

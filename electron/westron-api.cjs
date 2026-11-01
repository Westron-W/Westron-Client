const WESTRON_API_PATHS = Object.freeze({
  register: '/api/v1/auth/register',
  verifyEmail: '/api/v1/auth/verify-email',
  resendVerification: '/api/v1/auth/resend-verification',
  requestPasswordReset: '/api/v1/auth/request-password-reset',
  resetPassword: '/api/v1/auth/reset-password',
  login: '/api/v1/auth/login',
  refresh: '/api/v1/auth/refresh',
  logout: '/api/v1/auth/logout',
  profile: '/api/v1/me',
  minecraftProfile: '/api/v1/me/minecraft-profile',
  skin: '/api/v1/me/skin',
  cape: '/api/v1/me/cape',
});
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

const WESTRON_IPC_CHANNELS = Object.freeze({
  getAccount: 'app:westron-account',
  register: 'app:westron-register',
  login: 'app:westron-login',
  verifyEmail: 'app:westron-verify-email',
  resendVerification: 'app:westron-resend-verification',
  requestPasswordReset: 'app:westron-request-password-reset',
  resetPassword: 'app:westron-reset-password',
  profile: 'app:westron-profile',
  uploadSkin: 'app:westron-upload-skin',
  deleteSkin: 'app:westron-delete-skin',
  uploadCape: 'app:westron-upload-cape',
  deleteCape: 'app:westron-delete-cape',
  logout: 'app:westron-logout',
});

function registerWestronIpcHandlers(ipcMain, handlers) {
  for (const [name, channel] of Object.entries(WESTRON_IPC_CHANNELS)) {
    if (typeof handlers[name] === 'function') {
      ipcMain.handle(channel, (_event, input) => handlers[name](input));
    } else if (name !== 'uploadCape' && name !== 'deleteCape') {
      throw new Error(`Missing Westron IPC handler: ${name}`);
    }
  }
}

function createWestronAuthRefresher({
  readCredentials,
  refresh,
  saveCredentials,
  clearCredentials,
}) {
  const pendingRefreshes = new Map();

  return async function refreshCredentials(credentials) {
    const pending = pendingRefreshes.get(credentials.refreshToken);
    if (pending) return pending;

    const refreshPromise = (async () => {
      const stored = await readCredentials();
      if (!stored) {
        throw new Error('Westron oturumunuz sona erdi. Skin ve pelerin yüklemek için yeniden giriş yapın.');
      }
      if (stored.refreshToken !== credentials.refreshToken) return stored;

      try {
        const renewed = await refresh({ refreshToken: credentials.refreshToken });
        await saveCredentials(renewed);
        return renewed;
      } catch (error) {
        if (error.status !== 401) throw error;

        const latest = await readCredentials();
        if (latest && latest.refreshToken !== credentials.refreshToken) return latest;
        await clearCredentials();
        throw new Error('Westron oturumunuz sona erdi. Skin ve pelerin yüklemek için yeniden giriş yapın.');
      }
    })();

    pendingRefreshes.set(credentials.refreshToken, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      if (pendingRefreshes.get(credentials.refreshToken) === refreshPromise) {
        pendingRefreshes.delete(credentials.refreshToken);
      }
    }
  };
}

function createWestronApiClient({
  baseUrl = 'https://westronskin.sytes.net',
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = new URL(baseUrl);
  if (!['http:', 'https:'].includes(normalizedBaseUrl.protocol)
    || normalizedBaseUrl.username || normalizedBaseUrl.password
    || normalizedBaseUrl.pathname !== '/' || normalizedBaseUrl.search || normalizedBaseUrl.hash) {
    throw new Error('Westron Skin API base URL must be an HTTP(S) origin.');
  }

  async function request(endpoint, {
    method = 'GET',
    body,
    accessToken,
    headers = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('Westron API request timeout must be a positive integer.');
    }
    const requestHeaders = new Headers(headers);
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      requestHeaders.delete('Content-Type');
    }
    if (accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    const response = await fetchImpl(new URL(endpoint, normalizedBaseUrl), {
      method,
      headers: requestHeaders,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let result;
    if (response.status !== 204 && response.status !== 304) {
      try {
        result = response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : await response.text();
      } catch {
        throw new Error('Westron Skin API geçersiz bir yanıt döndürdü.');
      }
    }
    if (!response.ok && response.status !== 304) {
      const message = result?.error?.message;
      const upstreamUnavailable = response.status === 502 || response.status === 504;
      const missingRoute = response.status === 404 && (
        (result?.statusCode === 404 && result?.error === 'Not Found' && /Route (GET|POST|PUT|DELETE):\/.+ not found/i.test(result?.message || ''))
        || (result?.error?.code === 'not_found' && /Not Found - \//i.test(message || ''))
      );
      const error = new Error(missingRoute
        ? 'Westron Skin API uç noktası sunucuda bulunamadı (404). API sunucusu güncel skin-api koduyla yeniden dağıtılmalı.'
        : upstreamUnavailable
          ? `Westron Skin API sunucusuna şu anda ulaşılamıyor (${response.status}). VDS'de API container'ının çalıştığını ve proxy ağına bağlı olduğunu kontrol edin.`
        : typeof message === 'string'
          ? message
          : `Westron Skin API isteği başarısız oldu (${response.status}).`);
      error.status = response.status;
      error.code = missingRoute ? 'route_not_found' : upstreamUnavailable ? 'api_unavailable' : result?.error?.code;
      throw error;
    }
    return result;
  }

  async function postJson(endpoint, body) {
    return request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  return {
    request,
    register: (input) => postJson(WESTRON_API_PATHS.register, input),
    verifyEmail: (input) => postJson(WESTRON_API_PATHS.verifyEmail, input),
    resendVerification: (input) => postJson(WESTRON_API_PATHS.resendVerification, input),
    requestPasswordReset: (input) => postJson(WESTRON_API_PATHS.requestPasswordReset, input),
    resetPassword: (input) => postJson(WESTRON_API_PATHS.resetPassword, input),
    login: (input) => postJson(WESTRON_API_PATHS.login, input),
    refresh: (input) => postJson(WESTRON_API_PATHS.refresh, input),
    logout: (accessToken) => request(WESTRON_API_PATHS.logout, { method: 'POST', accessToken }),
    getProfile: (accessToken) => request(WESTRON_API_PATHS.profile, { accessToken }),
    setMinecraftProfile: (username, accessToken) => request(WESTRON_API_PATHS.minecraftProfile, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
      accessToken,
    }),
  };
}

module.exports = {
  DEFAULT_REQUEST_TIMEOUT_MS,
  WESTRON_API_PATHS,
  WESTRON_IPC_CHANNELS,
  createWestronAuthRefresher,
  createWestronApiClient,
  registerWestronIpcHandlers,
};

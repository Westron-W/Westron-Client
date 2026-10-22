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
  skin: '/api/v1/me/skin',
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
  logout: 'app:westron-logout',
});

function registerWestronIpcHandlers(ipcMain, handlers) {
  for (const [name, channel] of Object.entries(WESTRON_IPC_CHANNELS)) {
    if (typeof handlers[name] !== 'function') throw new Error(`Missing Westron IPC handler: ${name}`);
    ipcMain.handle(channel, (_event, input) => handlers[name](input));
  }
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
      const error = new Error(typeof message === 'string'
        ? message
        : `Westron Skin API isteği başarısız oldu (${response.status}).`);
      error.status = response.status;
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
  };
}

module.exports = {
  DEFAULT_REQUEST_TIMEOUT_MS,
  WESTRON_API_PATHS,
  WESTRON_IPC_CHANNELS,
  createWestronApiClient,
  registerWestronIpcHandlers,
};

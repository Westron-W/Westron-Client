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
  publicProfile: (username) => `/api/v1/profiles/${encodeURIComponent(username)}`,
  minecraftProfile: '/api/v1/me/minecraft-profile',
  skin: '/api/v1/me/skin',
  cape: '/api/v1/me/cape',
  elytra: '/api/v1/me/elytra',
  friends: '/api/v1/friends',
  friendSearch: '/api/v1/friends/search',
  friendRequests: '/api/v1/friends/requests',
  friendGroups: '/api/v1/friends/groups',
  friendGroup: (groupId) => `/api/v1/friends/groups/${encodeURIComponent(groupId)}`,
  friendGroupMember: (groupId, memberUserId) =>
    `/api/v1/friends/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberUserId)}`,
  friendGroupConversation: (groupId) =>
    `/api/v1/friends/groups/${encodeURIComponent(groupId)}/messages`,
  recallFriendGroupMessage: (groupId, messageId) =>
    `/api/v1/friends/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/recall`,
  friendGroupPhotoMessage: (groupId) =>
    `/api/v1/friends/groups/${encodeURIComponent(groupId)}/messages/photo`,
  friendGroupMessagePhoto: (groupId, messageId) =>
    `/api/v1/friends/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/photo`,
  respondFriendRequest: (requestId) => `/api/v1/friends/requests/${encodeURIComponent(requestId)}/respond`,
  cancelFriendRequest: (requestId) => `/api/v1/friends/requests/${encodeURIComponent(requestId)}`,
  removeFriend: (userId) => `/api/v1/friends/${encodeURIComponent(userId)}`,
  presence: '/api/v1/presence',
  friendMessages: '/api/v1/friends/messages',
  friendPhotoMessage: '/api/v1/friends/messages/photo',
  friendMessageInbox: '/api/v1/friends/messages/inbox',
  friendConversation: (friendUserId) => `/api/v1/friends/messages/conversation/${encodeURIComponent(friendUserId)}`,
  friendMessagePhoto: (messageId) => `/api/v1/friends/messages/${encodeURIComponent(messageId)}/photo`,
  consumeFriendMessage: (messageId) => `/api/v1/friends/messages/${encodeURIComponent(messageId)}/consume`,
  recallFriendMessage: (messageId) => `/api/v1/friends/messages/${encodeURIComponent(messageId)}/recall`,
  callIceServers: '/api/v1/friends/calls/ice-servers',
  callSignals: '/api/v1/friends/calls/signals',
  updateAsset: (fileName) => `/api/v1/admin/updates/${encodeURIComponent(fileName)}`,
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
  uploadElytra: 'app:westron-upload-elytra',
  deleteElytra: 'app:westron-delete-elytra',
  logout: 'app:westron-logout',
  listFriends: 'app:westron-list-friends',
  getFriendSkinUrl: 'app:westron-friend-skin-url',
  searchFriends: 'app:westron-search-friends',
  sendFriendRequest: 'app:westron-send-friend-request',
  respondFriendRequest: 'app:westron-respond-friend-request',
  cancelFriendRequest: 'app:westron-cancel-friend-request',
  removeFriend: 'app:westron-remove-friend',
  listGroups: 'app:westron-list-groups',
  createGroup: 'app:westron-create-group',
  renameGroup: 'app:westron-rename-group',
  deleteGroup: 'app:westron-delete-group',
  removeGroupMember: 'app:westron-remove-group-member',
  listGroupConversation: 'app:westron-list-group-conversation',
  sendGroupMessage: 'app:westron-send-group-message',
  getGroupMessagePhoto: 'app:westron-get-group-message-photo',
  sendGroupPhoto: 'app:westron-send-group-photo',
  updatePresence: 'app:westron-update-presence',
  sendEphemeralMessage: 'app:westron-send-ephemeral-message',
  listEphemeralMessages: 'app:westron-list-ephemeral-messages',
  consumeEphemeralMessage: 'app:westron-consume-ephemeral-message',
  listConversation: 'app:westron-list-conversation',
  getMessagePhoto: 'app:westron-get-message-photo',
  getVoiceCallIceServers: 'app:westron-get-voice-call-ice-servers',
  sendVoiceCallSignal: 'app:westron-send-voice-call-signal',
  consumeVoiceCallSignals: 'app:westron-consume-voice-call-signals',
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
  fallbackBaseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = new URL(baseUrl);
  const resolvedFallbackBaseUrl = fallbackBaseUrl === undefined
    ? normalizedBaseUrl.origin === 'https://westronclient.myvnc.com'
      ? 'https://westronskin.sytes.net'
      : null
    : fallbackBaseUrl;
  let normalizedFallbackBaseUrl = null;
  if (resolvedFallbackBaseUrl) {
    normalizedFallbackBaseUrl = new URL(resolvedFallbackBaseUrl);
  }
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
    responseType = 'json',
  } = {}) {
    if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
      throw new Error('Westron API request timeout must be a positive integer.');
    }
    const requestHeaders = new Headers(headers);
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      requestHeaders.delete('Content-Type');
    }
    if (accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    const originList = [normalizedBaseUrl];
    if (normalizedFallbackBaseUrl
      && normalizedFallbackBaseUrl.origin !== normalizedBaseUrl.origin) {
      originList.push(normalizedFallbackBaseUrl);
    }
    let response = null;
    for (const origin of originList) {
      try {
        response = await fetchImpl(new URL(endpoint, origin), {
          method,
          headers: requestHeaders,
          body,
          ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
        });
      } catch (error) {
        if (origin !== normalizedBaseUrl) throw error;
        continue;
      }
      if ((response.status === 404 || response.status === 405)
        && origin === normalizedBaseUrl
        && originList.length > 1) {
        continue;
      }
      break;
    }
    if (!response) throw new Error('Westron Skin API sunucusuna ulaşılamadı.');
    let result;
    if (response.status !== 204 && response.status !== 304) {
      try {
        result = responseType === 'base64' && response.ok
          ? Buffer.from(await response.arrayBuffer()).toString('base64')
          : response.headers.get('content-type')?.includes('application/json')
            ? await response.json()
            : await response.text();
      } catch {
        throw new Error('Westron Skin API geçersiz bir yanıt döndürdü.');
      }
    }
    if (!response.ok && response.status !== 304) {
      const message = result?.error?.message;
      const upstreamUnavailable = response.status === 502 || response.status === 504;
      const methodNotAllowed = response.status === 405;
      const missingRoute = response.status === 404 && (
        (result?.statusCode === 404 && result?.error === 'Not Found' && /Route (GET|POST|PUT|DELETE):\/.+ not found/i.test(result?.message || ''))
        || (result?.error?.code === 'not_found' && /Not Found - \//i.test(message || ''))
      );
      const error = new Error(missingRoute
        ? 'Westron Skin API uç noktası sunucuda bulunamadı (404). API sunucusu güncel skin-api koduyla yeniden dağıtılmalı.'
        : methodNotAllowed
          ? 'Westron Skin API isteği bu sunucuda desteklenmiyor (405). API sunucusunu güncel skin-api koduyla yeniden dağıtın.'
        : upstreamUnavailable
          ? `Westron Skin API sunucusuna şu anda ulaşılamıyor (${response.status}). VDS'de API container'ının çalıştığını ve proxy ağına bağlı olduğunu kontrol edin.`
        : typeof message === 'string'
          ? message
          : `Westron Skin API isteği başarısız oldu (${response.status}).`);
      error.status = response.status;
      error.code = missingRoute ? 'route_not_found' : methodNotAllowed ? 'method_not_allowed' : upstreamUnavailable ? 'api_unavailable' : result?.error?.code;
      throw error;
    }
    return result;
  }

  async function postJson(endpoint, body, accessToken) {
    return request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      accessToken,
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
    getPublicProfile: (username) => request(WESTRON_API_PATHS.publicProfile(username)),
    updateAsset: (fileName, options = {}) => request(WESTRON_API_PATHS.updateAsset(fileName), options),
    setMinecraftProfile: (username, accessToken) => request(WESTRON_API_PATHS.minecraftProfile, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
      accessToken,
    }),
    listFriends: (accessToken) => request(WESTRON_API_PATHS.friends, { accessToken }),
    searchFriends: (query, accessToken) => request(
      `${WESTRON_API_PATHS.friendSearch}?q=${encodeURIComponent(query)}`,
      { accessToken },
    ),
    sendFriendRequest: (username, accessToken) => postJson(WESTRON_API_PATHS.friendRequests, { username }, accessToken),
    respondFriendRequest: (requestId, accept, accessToken) =>
      postJson(WESTRON_API_PATHS.respondFriendRequest(requestId), { accept }, accessToken),
    cancelFriendRequest: (requestId, accessToken) => request(
      WESTRON_API_PATHS.cancelFriendRequest(requestId),
      { method: 'DELETE', accessToken },
    ),
    listGroups: (accessToken) => request(WESTRON_API_PATHS.friendGroups, { accessToken }),
    createGroup: (name, memberUserIds, accessToken) =>
      postJson(WESTRON_API_PATHS.friendGroups, { name, memberUserIds }, accessToken),
    renameGroup: (groupId, name, accessToken) => request(WESTRON_API_PATHS.friendGroup(groupId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      accessToken,
    }),
    deleteGroup: (groupId, accessToken) => request(WESTRON_API_PATHS.friendGroup(groupId), {
      method: 'DELETE',
      accessToken,
    }),
    removeGroupMember: (groupId, memberUserId, accessToken) => request(
      WESTRON_API_PATHS.friendGroupMember(groupId, memberUserId),
      { method: 'DELETE', accessToken },
    ),
    listGroupConversation: (groupId, accessToken) =>
      request(WESTRON_API_PATHS.friendGroupConversation(groupId), { accessToken }),
    sendGroupMessage: (groupId, body, accessToken) =>
      postJson(WESTRON_API_PATHS.friendGroupConversation(groupId), { body }, accessToken),
    recallGroupMessage: (groupId, messageId, accessToken) =>
      request(WESTRON_API_PATHS.recallFriendGroupMessage(groupId, messageId), {
        method: 'POST',
        accessToken,
      }),
    sendGroupPhotoMessage: (groupId, fileName, fileBuffer, accessToken) => {
      const form = new FormData();
      const contentType = /\.jpe?g$/i.test(fileName) ? 'image/jpeg' : 'image/png';
      form.append('photo', new Blob([fileBuffer], { type: contentType }), fileName);
      return request(WESTRON_API_PATHS.friendGroupPhotoMessage(groupId), {
        method: 'POST',
        body: form,
        accessToken,
        timeoutMs: null,
      });
    },
    getGroupMessagePhoto: (groupId, messageId, accessToken) => request(
      WESTRON_API_PATHS.friendGroupMessagePhoto(groupId, messageId),
      { accessToken, responseType: 'base64' },
    ),
    removeFriend: (userId, accessToken) => request(WESTRON_API_PATHS.removeFriend(userId), {
      method: 'DELETE',
      accessToken,
    }),
    updatePresence: (inGame, accessToken, serverName) => postJson(
      WESTRON_API_PATHS.presence,
      { inGame, ...(typeof serverName === 'string' ? { serverName } : {}) },
      accessToken,
    ),
    sendEphemeralMessage: (recipientUserId, body, accessToken) =>
      postJson(WESTRON_API_PATHS.friendMessages, { recipientUserId, body }, accessToken),
    sendPhotoMessage: (recipientUserId, fileName, fileBuffer, accessToken) => {
      const form = new FormData();
      form.append('recipientUserId', recipientUserId);
      const contentType = /\.jpe?g$/i.test(fileName) ? 'image/jpeg' : 'image/png';
      form.append('photo', new Blob([fileBuffer], { type: contentType }), fileName);
      return request(WESTRON_API_PATHS.friendPhotoMessage, {
        method: 'POST',
        body: form,
        accessToken,
        timeoutMs: null,
      });
    },
    listEphemeralMessages: (accessToken) => request(WESTRON_API_PATHS.friendMessageInbox, { accessToken }),
    listConversation: (friendUserId, accessToken) =>
      request(WESTRON_API_PATHS.friendConversation(friendUserId), { accessToken }),
    getMessagePhoto: (messageId, accessToken) => request(
      WESTRON_API_PATHS.friendMessagePhoto(messageId),
      { accessToken, responseType: 'base64' },
    ),
    consumeEphemeralMessage: (messageId, accessToken) => postJson(
      WESTRON_API_PATHS.consumeFriendMessage(messageId),
      {},
      accessToken,
    ),
    recallEphemeralMessage: (messageId, accessToken) =>
      request(WESTRON_API_PATHS.recallFriendMessage(messageId), {
        method: 'POST',
        accessToken,
      }),
    getVoiceCallIceServers: (accessToken) => request(WESTRON_API_PATHS.callIceServers, { accessToken }),
    sendVoiceCallSignal: (signal, accessToken) => postJson(WESTRON_API_PATHS.callSignals, signal, accessToken),
    consumeVoiceCallSignals: (accessToken) => request(WESTRON_API_PATHS.callSignals, { accessToken }),
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

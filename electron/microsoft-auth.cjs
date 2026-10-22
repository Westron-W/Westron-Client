const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/';

function validateMicrosoftAuthorizationUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:'
    || url.origin !== new URL(MICROSOFT_AUTH_URL).origin
    || !/^\/[^/]+\/oauth2\/v2\.0\/authorize$/.test(url.pathname)
    || !url.searchParams.has('state')
    || !url.searchParams.has('code_challenge')
    || url.searchParams.get('code_challenge_method') !== 'S256') {
    throw new Error('Microsoft kimlik doğrulama adresi güvenli biçimde doğrulanamadı.');
  }
  return url.toString();
}

function publicAccountFromSession(session, profile = session.minecraft) {
  const activeSkin = profile.skins?.find((skin) => skin.state === 'ACTIVE');
  return {
    username: profile.username,
    uuid: profile.uuid,
    skinUrl: activeSkin?.url ?? null,
  };
}

function createAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isNetworkError(error) {
  const networkCodes = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
  ]);
  let current = error;
  while (current) {
    if (networkCodes.has(current.code)
      || current.name === 'TimeoutError'
      || /fetch failed|network error|network request failed|socket hang up|timed? ?out/i.test(current.message ?? '')) {
      return true;
    }
    current = current.cause;
  }
  const status = error?.context?.httpStatus;
  return status === 408 || status === 429 || status >= 500;
}

function createMicrosoftAuthService({
  getMinecraftKit,
  clientIdValue,
  openExternal,
  loadStoredAuth,
  saveStoredAuth,
  clearStoredAuth,
}) {
  let activeSignInController = null;

  async function getConfiguredKit() {
    if (!clientIdValue || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientIdValue)) {
      throw createAuthError('AUTH_MISSING_CLIENT_ID', 'Microsoft girişi yapılandırılmamış. Microsoft uygulama Client ID değerini MINECRAFT_KIT_MSA_CLIENT_ID ortam değişkenine ekleyin.');
    }
    const kitModule = await getMinecraftKit();
    let clientId;
    try {
      clientId = kitModule.asAzureClientId(clientIdValue);
    } catch {
      throw createAuthError('AUTH_INVALID_CLIENT_ID', 'Microsoft Client ID biçimi geçersiz. Azure uygulama kaydındaki Application (client) ID değerini kontrol edin.');
    }
    return { ...kitModule, clientId };
  }

  async function verifyProfile(kit, session, signal) {
    if (!session?.minecraft?.accessToken
      || typeof session.minecraft.username !== 'string'
      || typeof session.minecraft.uuid !== 'string') {
      throw createAuthError('AUTH_PROFILE_FAILED', 'Minecraft Java Edition profili doğrulanamadı.');
    }
    const profile = await kit.auth.profile.read({
      accessToken: session.minecraft.accessToken,
      ...(signal ? { signal } : {}),
    });
    if (profile.username !== session.minecraft.username
      || profile.uuid.toLowerCase() !== session.minecraft.uuid.toLowerCase()) {
      throw createAuthError('AUTH_PROFILE_FAILED', 'Microsoft hesabının Minecraft profili doğrulanamadı.');
    }
    return profile;
  }

  function authError(error) {
    if (isNetworkError(error)) {
      return new Error('Microsoft, Xbox veya Minecraft sunucularına ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.');
    }
    if (error?.context?.reason === 'invalid_app_registration'
      || /invalid app registration|has not approved this azure ad application/i.test(error?.message ?? '')) {
      return new Error('Microsoft girişiniz alındı ancak Minecraft Services bu uygulamayı henüz onaylamamış. Uygulama sahibi Microsoft üzerinden Minecraft Java istemci kimliği onayı almalıdır.');
    }
    switch (error?.code) {
      case 'AUTH_CANCELLED':
        return new Error('Microsoft ile giriş iptal edildi.');
      case 'AUTH_AUTHORIZATION_CODE_DECLINED':
        return new Error('Microsoft giriş isteği reddedildi. Giriş yapmak için izin verip yeniden deneyin.');
      case 'AUTH_INVALID_CLIENT_ID':
        return error;
      case 'AUTH_NO_GAME_OWNERSHIP':
        return new Error('Bu Microsoft hesabında Minecraft: Java Edition lisansı veya oyun profili bulunamadı.');
      case 'AUTH_MISSING_CLIENT_ID':
        return new Error('Microsoft girişi yapılandırılmamış. MINECRAFT_KIT_MSA_CLIENT_ID değerini ayarlayın.');
      case 'AUTH_XBOX_FAILED':
        return new Error('Xbox Live doğrulaması başarısız oldu. Microsoft hesabınızın Xbox hizmetlerine erişebildiğini kontrol edin.');
      case 'AUTH_XSTS_FAILED':
        return new Error('Xbox güvenlik doğrulaması tamamlanamadı. Hesabınızın Xbox profilini ve çevrimiçi güvenlik ayarlarını kontrol edin.');
      case 'AUTH_BROWSER_OPEN_FAILED':
        return error;
      case 'AUTH_STORAGE_FAILED':
        return new Error('Microsoft oturum bilgileri işletim sisteminin güvenli deposuna kaydedilemedi. Güvenli depolama kullanılabilir olduğunda yeniden deneyin.');
      case 'AUTH_PROFILE_FAILED':
        return error;
      case 'AUTH_MINECRAFT_FAILED':
        return new Error('Minecraft Services doğrulaması veya Java profili kontrolü başarısız oldu. Hesap erişiminizi kontrol edip yeniden deneyin.');
      case 'AUTH_AUTHORIZATION_CODE_FAILED':
        return new Error('Microsoft kimlik doğrulaması tamamlanamadı. Giriş bilgilerinizi ve uygulama yapılandırmasını kontrol edip yeniden deneyin.');
      case 'AUTH_REFRESH_FAILED':
        return new Error('Microsoft oturumu yenilenemedi. Yeniden Microsoft hesabıyla giriş yapın.');
      default:
        return new Error('Microsoft ile giriş tamamlanamadı. İşlemi yeniden deneyin.');
    }
  }

  async function signIn() {
    if (activeSignInController) {
      throw new Error('Microsoft giriş işlemi zaten devam ediyor.');
    }
    const controller = new AbortController();
    activeSignInController = controller;
    try {
      const { kit, clientId } = await getConfiguredKit();
      const session = await kit.auth.authorizationCode.run({
        clientId,
        signal: controller.signal,
        successHtml: '<!doctype html><meta charset="utf-8"><title>Westron Client</title><style>body{background:#0b0d11;color:#e8eaf0;font:16px Segoe UI,sans-serif;display:grid;place-items:center;height:90vh}main{text-align:center}h1{color:#c1b2ff}</style><main><h1>Westron Client</h1><p>Microsoft girişi tamamlandı. Bu pencereyi kapatıp launcher’a dönebilirsiniz.</p></main>',
        onOpenBrowser: async (url) => {
          const safeUrl = validateMicrosoftAuthorizationUrl(url);
          try {
            await openExternal(safeUrl);
          } catch {
            throw createAuthError('AUTH_BROWSER_OPEN_FAILED', 'Varsayılan tarayıcı açılamadı. Microsoft giriş bağlantısını yeniden deneyin.');
          }
        },
      });
      const profile = await verifyProfile(kit, session, controller.signal);
      if (typeof session.microsoft?.refreshToken !== 'string' || !session.microsoft.refreshToken) {
        throw createAuthError('AUTH_MINECRAFT_FAILED', 'Microsoft oturum yenileme bilgisi alınamadı.');
      }
      const account = publicAccountFromSession(session, profile);
      if (controller.signal.aborted) throw createAuthError('AUTH_CANCELLED', 'Microsoft sign-in cancelled.');
      try {
        await saveStoredAuth({
          refreshToken: session.microsoft.refreshToken,
          account,
        });
      } catch {
        throw createAuthError('AUTH_STORAGE_FAILED', 'Microsoft oturum bilgileri güvenli depoya kaydedilemedi.');
      }
      return account;
    } catch (error) {
      console.error('[Microsoft Auth Diagnostic]', { code: error?.code, message: error?.message, context: error?.context, cause: error?.cause?.message, name: error?.name });
      if (controller.signal.aborted) throw new Error('Microsoft ile giriş iptal edildi.');
      throw authError(error);
    } finally {
      if (activeSignInController === controller) activeSignInController = null;
    }
  }

  function cancelSignIn() {
    if (activeSignInController && !activeSignInController.signal.aborted) {
      activeSignInController.abort();
    }
    return 'Microsoft giriş işlemi iptal ediliyor.';
  }

  async function getAccount() {
    const credentials = await loadStoredAuth();
    return credentials?.account ?? null;
  }

  async function getLaunchSession() {
    const credentials = await loadStoredAuth();
    if (!credentials) throw new Error('Minecraft için önce Microsoft hesabıyla giriş yapın.');
    const { kit, clientId, asMicrosoftRefreshToken, toOnlineAuth } = await getConfiguredKit();
    try {
      const session = await kit.auth.refresh(
        asMicrosoftRefreshToken(credentials.refreshToken),
        { clientId },
      );
      const profile = await verifyProfile(kit, session);
      if (typeof session.microsoft?.refreshToken !== 'string' || !session.microsoft.refreshToken) {
        throw createAuthError('AUTH_REFRESH_FAILED', 'Microsoft oturum yenileme bilgisi alınamadı.');
      }
      const account = publicAccountFromSession(session, profile);
      try {
        await saveStoredAuth({
          refreshToken: session.microsoft.refreshToken,
          account,
        });
      } catch {
        throw createAuthError('AUTH_STORAGE_FAILED', 'Microsoft oturum bilgileri güvenli depoya kaydedilemedi.');
      }
      return { account, auth: toOnlineAuth(session) };
    } catch (error) {
      if (error?.code === 'AUTH_NO_GAME_OWNERSHIP') await clearStoredAuth();
      throw authError(error);
    }
  }

  async function signOut() {
    await clearStoredAuth();
    return 'Microsoft hesabından bu cihazda çıkış yapıldı.';
  }

  return { signIn, cancelSignIn, getAccount, getLaunchSession, signOut };
}

module.exports = {
  MICROSOFT_AUTH_URL,
  createMicrosoftAuthService,
  publicAccountFromSession,
  validateMicrosoftAuthorizationUrl,
};

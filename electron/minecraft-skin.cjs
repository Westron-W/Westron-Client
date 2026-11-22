const PROFILE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const TEXTURE_URL_PATTERN = /^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]{32,64}$/i;

function createMinecraftSkinLookup({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const cache = new Map();

  return async function getMinecraftSkinUrl(username) {
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
      throw new Error('Minecraft kullanıcı adı geçersiz.');
    }
    const cacheKey = username.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = (async () => {
      const profileResponse = await fetchImpl(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (profileResponse.status === 204 || profileResponse.status === 404) return null;
      if (!profileResponse.ok) throw new Error(`Minecraft profile lookup failed (${profileResponse.status}).`);
      const profile = await profileResponse.json();
      if (typeof profile?.id !== 'string' || !PROFILE_ID_PATTERN.test(profile.id)) {
        throw new Error('Minecraft profile response is invalid.');
      }

      const sessionResponse = await fetchImpl(
        `https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}?unsigned=false`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (sessionResponse.status === 204 || sessionResponse.status === 404) return null;
      if (!sessionResponse.ok) throw new Error(`Minecraft skin lookup failed (${sessionResponse.status}).`);
      const session = await sessionResponse.json();
      const textures = session?.properties?.find((property) => property.name === 'textures');
      if (typeof textures?.value !== 'string') return null;
      const decoded = JSON.parse(Buffer.from(textures.value, 'base64').toString('utf8'));
      const textureUrl = decoded?.textures?.SKIN?.url;
      if (typeof textureUrl !== 'string' || !TEXTURE_URL_PATTERN.test(textureUrl)) return null;
      return textureUrl;
    })();

    cache.set(cacheKey, { promise, expiresAt: Date.now() + 60 * 60 * 1000 });
    try {
      return await promise;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
  };
}

module.exports = { createMinecraftSkinLookup };

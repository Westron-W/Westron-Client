import { useEffect, useRef, useState } from 'react';

const WESTRON_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const friendSkinUrlCache = new Map<string, { expiresAt: number; promise: Promise<string | null> }>();

export function getFriendSkinUrl(username: string, minecraftUsername?: string | null) {
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!WESTRON_USERNAME_PATTERN.test(normalizedUsername)) {
    console.warn('[Westron] Profil adı geçersiz olduğu için skin isteği atlandı.');
    return Promise.resolve(null);
  }
  const rawMinecraftUsername = typeof minecraftUsername === 'string' ? minecraftUsername.trim() : '';
  const normalizedMinecraftUsername = WESTRON_USERNAME_PATTERN.test(rawMinecraftUsername)
    ? rawMinecraftUsername
    : undefined;
  if (rawMinecraftUsername && !normalizedMinecraftUsername) {
    console.warn('[Westron] Minecraft kullanıcı adı geçersiz; skin araması Westron adıyla yapılacak.');
  }
  const cacheKey = `${normalizedUsername.toLowerCase()}:${normalizedMinecraftUsername?.toLowerCase() ?? ''}`;
  const cached = friendSkinUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = window.nocturne.getWestronFriendSkinUrl({
    username: normalizedUsername,
    minecraftUsername: normalizedMinecraftUsername,
  });
  friendSkinUrlCache.set(cacheKey, { promise, expiresAt: Date.now() + 5 * 60 * 1000 });
  return promise;
}

export function FriendSkinFace({
  username,
  minecraftUsername,
}: {
  username: string;
  minecraftUsername?: string | null;
}) {
  const [skinImageUrl, setSkinImageUrl] = useState('');
  const [legacySkin, setLegacySkin] = useState(false);
  const skinLoadFailedRef = useRef(false);
  const fallbackSkinUrlRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    skinLoadFailedRef.current = false;
    fallbackSkinUrlRef.current = null;
    setLegacySkin(false);
    setSkinImageUrl('');
    void getFriendSkinUrl(username, minecraftUsername)
      .then((url) => { if (active && url) setSkinImageUrl(url); });
    return () => { active = false; };
  }, [username, minecraftUsername]);
  const handleSkinError = () => {
    if (fallbackSkinUrlRef.current === skinImageUrl) {
      setSkinImageUrl('');
      return;
    }
    if (skinLoadFailedRef.current) return;
    skinLoadFailedRef.current = true;
    void window.nocturne.getMinecraftSkinUrl({ username: minecraftUsername || username })
      .then((url) => {
        if (url && url !== skinImageUrl) {
          fallbackSkinUrlRef.current = url;
          setSkinImageUrl(url);
        } else {
          setSkinImageUrl('');
        }
      })
      .catch(() => setSkinImageUrl(''));
  };
  if (!skinImageUrl) {
    return <div className="friends-face-fallback" aria-label={username}>{username.slice(0, 1).toUpperCase()}</div>;
  }
  return (
    <div className="skin-face-texture friends-face-texture" data-skin-format={legacySkin ? 'legacy' : 'modern'} aria-label={username}>
      <img className="skin-face-base" src={skinImageUrl} alt="" onLoad={(event) => setLegacySkin(event.currentTarget.naturalHeight * 2 === event.currentTarget.naturalWidth)} onError={handleSkinError} />
      <img className="skin-face-overlay" src={skinImageUrl} alt="" onLoad={(event) => setLegacySkin(event.currentTarget.naturalHeight * 2 === event.currentTarget.naturalWidth)} onError={handleSkinError} />
    </div>
  );
}

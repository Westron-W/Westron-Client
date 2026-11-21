function canGrantAudioMediaPermission({
  permission,
  mediaTypes,
  url,
  isDevelopment,
  productionRendererUrl,
}) {
  if (permission !== 'media'
    || !Array.isArray(mediaTypes)
    || mediaTypes.length !== 1
    || mediaTypes[0] !== 'audio'
    || typeof url !== 'string') {
    return false;
  }

  if (!isDevelopment) return url === productionRendererUrl;
  try {
    const rendererUrl = new URL(url);
    return rendererUrl.origin === 'http://localhost:5173';
  } catch {
    return false;
  }
}

module.exports = { canGrantAudioMediaPermission };

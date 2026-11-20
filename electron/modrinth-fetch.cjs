function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableResponse(response) {
  return response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
}

function getRetryDelay(response, attempt) {
  const retryAfterSeconds = Number(response.headers?.get('retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(3000, retryAfterSeconds * 1000);
  }
  return Math.min(1200, 250 * (2 ** attempt));
}

async function fetchWithRetry(url, options = {}, {
  fetchImpl = globalThis.fetch,
  waitImpl = wait,
  attempts = 3,
  timeoutMs = 15000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('HTTP istemcisi kullanılamıyor.');
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error('HTTP deneme sayısı geçersiz.');

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await waitImpl(Math.min(1200, 250 * (2 ** attempt)));
      continue;
    }

    if (!isRetryableResponse(response) || attempt === attempts - 1) return response;
    await waitImpl(getRetryDelay(response, attempt));
  }
  throw new Error('HTTP isteği tamamlanamadı.');
}

module.exports = { fetchWithRetry };

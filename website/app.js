const API_ROOT = "/_api";
const ACCESS_KEY = "westron.accessToken";
const REFRESH_KEY = "westron.refreshToken";
const EXPIRY_KEY = "westron.accessExpiresAt";
const SESSION_EXPIRY_KEY = "westron.sessionExpiresAt";
const ACCOUNT_KEY = "westron.account";
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const authCard = document.querySelector("#authCard");
const accountSummary = document.querySelector("#accountSummary");
const characterLocked = document.querySelector("#characterLocked");
const characterStudio = document.querySelector("#characterStudio");
const views = [...document.querySelectorAll(".auth-view")];
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const verifyForm = document.querySelector("#verifyForm");
const forgotForm = document.querySelector("#forgotForm");
const resetForm = document.querySelector("#resetForm");
const skinForm = document.querySelector("#skinUploadForm");
const skinInput = document.querySelector("#skinFile");
const capeInput = document.querySelector("#capeFile");
const apiStatus = document.querySelector("#apiStatus");
const modelStage = document.querySelector("#modelStage");
const skinViewer = new skinview3d.SkinViewer({
  canvas: document.querySelector("#skinViewer"),
  width: 640,
  height: 308,
  background: null,
  enableControls: true,
  pixelRatio: "match-device",
  zoom: 0.75,
});
skinViewer.controls.enablePan = false;
skinViewer.autoRotate = true;
skinViewer.autoRotateSpeed = 0.5;
skinViewer.animation = new skinview3d.WalkingAnimation();
new ResizeObserver(() => {
  const { width, height } = modelStage.getBoundingClientRect();
  if (width > 0 && height > 0) skinViewer.setSize(width, height);
}).observe(modelStage);
let selectedSkin = null;
let profile = null;
let rememberedEmail = "";
let previewUrl = "";
let capePreviewUrl = "";
let modelImageVersion = 0;
let capeImageVersion = 0;
let sessionExpiryTimer = 0;
let rotateEnabled = true;
let animationPaused = false;
let selectedModel = "classic";

function setMessage(id, message = "", kind = "") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.className = `form-message${kind ? ` ${kind}` : ""}`;
}

function setBusy(form, busy, buttonText) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  const label = button.querySelector("span");
  if (label) {
    if (busy) {
      button.dataset.originalText = label.textContent;
      label.textContent = buttonText || "İşleniyor…";
    } else {
      label.textContent = button.dataset.originalText || label.textContent;
    }
  }
}

function savedAccount() {
  try {
    return JSON.parse(sessionStorage.getItem(ACCOUNT_KEY) || "null");
  } catch {
    return null;
  }
}

function setPage(name) {
  document.querySelectorAll(".app-page").forEach((page) => {
    const active = page.id === `${name}Page`;
    page.classList.toggle("active", active);
    page.classList.toggle("hidden", !active);
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === name;
    button.classList.toggle("active", active && button.classList.contains("nav-link"));
    if (active && button.classList.contains("nav-link")) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (name === "character") {
    characterLocked.classList.toggle("hidden", Boolean(profile));
    characterStudio.classList.toggle("hidden", !profile);
    requestAnimationFrame(() => {
      const { width, height } = modelStage.getBoundingClientRect();
      if (width > 0 && height > 0) skinViewer.setSize(width, height);
    });
  }
  if (name === "account") {
    const signedIn = Boolean(profile);
    accountSummary.classList.toggle("hidden", !signedIn);
    authCard.classList.toggle("hidden", signedIn);
    if (!signedIn && !views.some((view) => !view.classList.contains("hidden"))) setView("login");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setView(name) {
  views.forEach((view) => view.classList.toggle("hidden", view.id !== `${name}View`));
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.dataset.view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (name === "verify" && rememberedEmail) verifyForm.elements.email.value = rememberedEmail;
  if (name === "forgot" && rememberedEmail) forgotForm.elements.email.value = rememberedEmail;
}

function tokens() {
  return {
    access: sessionStorage.getItem(ACCESS_KEY),
    refresh: sessionStorage.getItem(REFRESH_KEY),
    expiresAt: Number(sessionStorage.getItem(EXPIRY_KEY) || 0),
    sessionExpiresAt: Number(sessionStorage.getItem(SESSION_EXPIRY_KEY) || 0),
  };
}

function saveTokens(data) {
  sessionStorage.setItem(ACCESS_KEY, data.accessToken);
  sessionStorage.setItem(REFRESH_KEY, data.refreshToken);
  sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + data.expiresIn * 1000));
  const existingSessionExpiry = Number(sessionStorage.getItem(SESSION_EXPIRY_KEY) || 0);
  if (!Number.isFinite(existingSessionExpiry) || existingSessionExpiry <= Date.now()) {
    const serverRefreshTtl = Number(data.refreshExpiresIn);
    const sessionAge = Number.isFinite(serverRefreshTtl) && serverRefreshTtl > 0
      ? Math.min(serverRefreshTtl * 1000, MAX_SESSION_AGE_MS)
      : MAX_SESSION_AGE_MS;
    sessionStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + sessionAge));
  }
  if (data.account) sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(data.account));
  scheduleSessionExpiry();
}

function clearSession() {
  window.clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = 0;
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
  sessionStorage.removeItem(SESSION_EXPIRY_KEY);
  sessionStorage.removeItem(ACCOUNT_KEY);
  profile = null;
  selectedSkin = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (capePreviewUrl) URL.revokeObjectURL(capePreviewUrl);
  previewUrl = "";
  capePreviewUrl = "";
  capeImageVersion++;
  skinViewer.loadSkin(null);
  skinViewer.loadCape(null);
}

function expireSession() {
  clearSession();
  accountSummary.classList.add("hidden");
  authCard.classList.remove("hidden");
  characterStudio.classList.add("hidden");
  characterLocked.classList.remove("hidden");
  setPage("account");
  setView("login");
  setMessage("loginMessage", "Oturumun sona erdi. Lütfen yeniden giriş yap.", "error");
}

function scheduleSessionExpiry() {
  window.clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = 0;
  const session = tokens();
  if (!session.refresh || !session.sessionExpiresAt) return;
  const remaining = session.sessionExpiresAt - Date.now();
  if (remaining <= 0) {
    expireSession();
    return;
  }
  sessionExpiryTimer = window.setTimeout(
    scheduleSessionExpiry,
    Math.min(remaining, 24 * 60 * 60 * 1000),
  );
}

async function readResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function apiError(payload, status) {
  if (payload?.error?.message) return payload.error.message;
  if (status === 429) return "Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar dene.";
  if (status >= 500) return "Sunucu şu anda isteği tamamlayamadı. Biraz sonra tekrar dene.";
  return payload?.message || "İstek tamamlanamadı. Bilgilerini kontrol edip tekrar dene.";
}

async function refreshSession() {
  const session = tokens();
  const refreshToken = session.refresh;
  if (!refreshToken) return false;
  if (session.sessionExpiresAt && session.sessionExpiresAt <= Date.now()) {
    expireSession();
    return false;
  }
  try {
    const response = await fetch(`${API_ROOT}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = await readResponse(response);
    if (!response.ok) {
      clearSession();
      return false;
    }
    saveTokens(payload);
    return true;
  } catch {
    throw new Error("Sunucuya bağlanılamadı. Oturumun şu anda yenilenemiyor.");
  }
}

async function request(path, options = {}, retry = true) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  const session = tokens();
  if (options.auth) {
    if (!session.access) throw new Error("Oturum bulunamadı. Yeniden giriş yap.");
    if (session.sessionExpiresAt && session.sessionExpiresAt <= Date.now()) {
      expireSession();
      throw new Error("Oturumun sona erdi. Lütfen yeniden giriş yap.");
    }
    if (session.expiresAt && session.expiresAt <= Date.now() + 15000) {
      let refreshed;
      try {
        refreshed = await refreshSession();
      } catch (error) {
        setPage("account");
        setMessage("loginMessage", error.message, "error");
        throw error;
      }
      if (!refreshed) {
        setPage("account");
        setMessage("loginMessage", "Oturumun sona erdi. Lütfen yeniden giriş yap.", "error");
        throw new Error("Oturumun sona erdi. Lütfen yeniden giriş yap.");
      }
      return request(path, options, retry);
    }
    headers.set("Authorization", `Bearer ${session.access}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers,
      body: options.body instanceof FormData
        ? options.body
        : options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("Sunucuya bağlanılamadı. İnternet bağlantını kontrol edip tekrar dene.");
  }

  if (response.status === 401 && options.auth && retry && path !== "/v1/auth/refresh") {
    let refreshed;
    try {
      refreshed = await refreshSession();
    } catch (error) {
      setPage("account");
      setMessage("loginMessage", error.message, "error");
      throw error;
    }
    if (refreshed) return request(path, options, false);
    clearSession();
    setPage("account");
    setMessage("loginMessage", "Oturumun sona erdi. Lütfen yeniden giriş yap.", "error");
    throw new Error("Oturumun sona erdi. Lütfen yeniden giriş yap.");
  }

  const payload = await readResponse(response);
  if (!response.ok) throw new Error(apiError(payload, response.status));
  return payload;
}

async function checkApi() {
  try {
    await request("/health");
    apiStatus.classList.add("online");
    apiStatus.classList.remove("offline");
    apiStatus.querySelector("span").textContent = "Skin API çevrimiçi";
  } catch {
    apiStatus.classList.add("offline");
    apiStatus.classList.remove("online");
    apiStatus.querySelector("span").textContent = "API bağlantısı yok";
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Görsel yüklenemedi."));
    image.src = url;
  });
}

function drawAccountFace(image) {
  const faceCrop = document.createElement("canvas");
  faceCrop.width = 64;
  faceCrop.height = 64;
  const faceContext = faceCrop.getContext("2d");
  faceContext.imageSmoothingEnabled = false;
  faceContext.drawImage(image, 8, 8, 8, 8, 0, 0, 64, 64);
  faceContext.drawImage(image, 40, 8, 8, 8, 0, 0, 64, 64);
  const faceUrl = faceCrop.toDataURL("image/png");
  document.querySelector("#accountFace").src = faceUrl;
  document.querySelector("#accountAvatar").src = faceUrl;
}

function makeDefaultSkin() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const fill = (color, x, y, width, height) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  fill("#704b31", 0, 0, 32, 16);
  fill("#d3a27c", 8, 8, 8, 8);
  fill("#704b31", 8, 8, 8, 2);
  fill("#315eac", 20, 20, 8, 12);
  fill("#315eac", 16, 20, 4, 12);
  fill("#315eac", 28, 20, 4, 12);
  fill("#704b31", 32, 20, 8, 12);
  fill("#315eac", 44, 20, 4, 9);
  fill("#d3a27c", 44, 29, 4, 3);
  fill("#315eac", 40, 20, 4, 9);
  fill("#d3a27c", 40, 29, 4, 3);
  fill("#315eac", 48, 20, 4, 12);
  fill("#315eac", 52, 20, 4, 12);
  fill("#315eac", 36, 52, 4, 12);
  fill("#d3a27c", 36, 52, 4, 2);
  fill("#315eac", 32, 52, 4, 12);
  fill("#315eac", 40, 52, 4, 12);
  fill("#315eac", 44, 52, 4, 12);
  fill("#315eac", 4, 20, 4, 12);
  fill("#315eac", 0, 20, 4, 12);
  fill("#315eac", 8, 20, 4, 12);
  fill("#704b31", 12, 20, 4, 12);
  fill("#315eac", 20, 52, 4, 12);
  fill("#315eac", 16, 52, 4, 12);
  fill("#315eac", 24, 52, 4, 12);
  fill("#704b31", 28, 52, 4, 12);
  fill("#20202b", 9, 12, 2, 2);
  fill("#20202b", 14, 12, 2, 2);
  fill("#7351a7", 40, 8, 8, 2);
  return loadImage(canvas.toDataURL("image/png"));
}

async function setCapeTexture(url) {
  const version = ++capeImageVersion;
  if (!url) {
    skinViewer.loadCape(null);
    document.querySelector("#capeThumb").style.backgroundImage = "";
    document.querySelector("#capeThumb").textContent = "✦";
    return true;
  }
  const image = await loadImage(url);
  if (version !== capeImageVersion) return false;
  skinViewer.loadCape(image);
  const thumb = document.querySelector("#capeThumb");
  thumb.textContent = "";
  thumb.style.backgroundImage = `url("${url}")`;
  thumb.style.backgroundSize = "cover";
  return true;
}

async function renderProfileAppearance() {
  const version = ++modelImageVersion;
  const skinUrl = selectedSkin && previewUrl
    ? previewUrl
    : profile?.skin?.url
      ? `${profile.skin.url}?v=${encodeURIComponent(profile.skin.updatedAt || Date.now())}`
      : null;
  let image;
  let loadedAccountSkin = Boolean(skinUrl);
  try {
    image = skinUrl ? await loadImage(skinUrl) : await makeDefaultSkin();
  } catch {
    loadedAccountSkin = false;
    image = await makeDefaultSkin();
    setMessage("dashboardMessage", "Skin görseli yüklenemedi; varsayılan önizleme gösteriliyor.", "error");
  }
  if (version !== modelImageVersion) return;
  skinViewer.loadSkin(image, { model: selectedModel === "slim" ? "slim" : "default" });
  drawAccountFace(image);
  document.querySelector("#skinModelSelect").value = selectedModel;
  document.querySelector("#skinDetail").textContent = profile?.skin
    ? `${selectedModel === "slim" ? "Slim" : "Classic"} model · ${new Date(profile.skin.updatedAt).toLocaleDateString("tr-TR")}`
    : "Henüz bir skin yüklemedin";
  document.querySelector("#skinFileName").textContent = profile?.skin ? "PNG skin seç" : "PNG skin yükle";
  document.querySelector("#uploadButton").textContent = profile?.skin ? "Skinini güncelle" : "Skin yükle";
  document.querySelector("#uploadButton").disabled = !selectedSkin;
  document.querySelector("#deleteSkinButton").classList.toggle("hidden", !profile?.skin);
  const capeUrl = capePreviewUrl || (profile?.cape?.url
    ? `${profile.cape.url}?v=${encodeURIComponent(profile.cape.updatedAt || Date.now())}`
    : null);
  try {
    if (!await setCapeTexture(capeUrl)) return;
    document.querySelector("#capeUploadButton").classList.add("hidden");
    document.querySelector("#capeDetail").textContent = profile?.cape
      ? `Güncelleme: ${new Date(profile.cape.updatedAt).toLocaleDateString("tr-TR")}`
      : "Henüz bir pelerin yüklemedin";
    document.querySelector("#capeFileName").textContent = profile?.cape ? "Pelerinini güncelle" : "PNG pelerin yükle";
    document.querySelector("#deleteCapeButton").classList.toggle("hidden", !profile?.cape);
  } catch {
    setMessage("capeMessage", "Pelerin önizlemesi yüklenemedi.", "error");
  }
}

function renderAccount() {
  const account = savedAccount();
  document.querySelector("#accountUsername").textContent = profile.username;
  document.querySelector("#accountEmail").textContent = account?.email || "E-posta bilgisi bulunamadı";
  const verified = Boolean(account?.emailVerified);
  const badge = document.querySelector("#verifiedBadge");
  badge.classList.toggle("unverified", !verified);
  badge.innerHTML = verified ? "<i>✓</i> E-posta doğrulandı" : "<i>!</i> E-posta doğrulanmadı";
  document.querySelector("#accountStatusTitle").textContent = verified ? "Hesabın doğrulandı" : "E-posta doğrulaması gerekli";
}

async function loadProfile() {
  profile = await request("/v1/me", { auth: true });
  selectedModel = profile.skin?.model || "classic";
  renderAccount();
  await renderProfileAppearance();
  accountSummary.classList.remove("hidden");
  authCard.classList.add("hidden");
  characterLocked.classList.add("hidden");
  characterStudio.classList.remove("hidden");
}

function setSelectedFile(file) {
  selectedSkin = file || null;
  if (!selectedSkin) {
    document.querySelector("#skinFileName").textContent = profile?.skin ? "Skinini güncelle" : "PNG skin yükle";
    return;
  }
  document.querySelector("#skinFileName").textContent = selectedSkin.name;
  document.querySelector("#uploadButton").disabled = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(selectedSkin);
}

async function validatePngFile(file, type) {
  if (!file) throw new Error("Önce bir PNG dosyası seç.");
  if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
    throw new Error("Dosya yalnızca PNG biçiminde olabilir.");
  }
  if (file.size > 1024 * 1024) throw new Error("Dosya 1 MB sınırını aşıyor.");
  if (file.size < 24) throw new Error("Seçilen dosya geçerli bir PNG gibi görünmüyor.");
  const bytes = new DataView(await file.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => bytes.getUint8(index) !== byte)) throw new Error("Dosya geçerli bir PNG değil.");
  const width = bytes.getUint32(16);
  const height = bytes.getUint32(20);
  if (type === "skin" && width === 64 && (height === 64 || height === 32)) return;
  if (type === "cape" && (
    (width === 64 && height === 32)
    || (width === 22 && height === 17)
    || (width / height === 2 && width <= 1024 && height <= 512)
  )) return;
  throw new Error(type === "skin"
    ? "Skin boyutu 64×64 veya klasik 64×32 piksel olmalıdır."
    : "Pelerin boyutu 64×32, 22×17 veya 2:1 oranında olmalıdır.");
}

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "forgot") rememberedEmail = loginForm.elements.email.value.trim() || rememberedEmail;
    if (button.dataset.view === "verify") setMessage("verifyMessage");
    setView(button.dataset.view);
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("loginMessage");
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  rememberedEmail = data.email;
  setBusy(form, true, "Giriş yapılıyor…");
  try {
    const session = await request("/v1/auth/login", { method: "POST", body: data });
    saveTokens(session);
    await loadProfile();
    setPage("character");
  } catch (error) {
    const needsVerification = /doğrulayın|doğrulanmış/i.test(error.message);
    if (tokens().access) clearSession();
    if (needsVerification) {
      setMessage("verifyMessage", error.message, "error");
      setView("verify");
    } else {
      setMessage("loginMessage", error.message, "error");
    }
  } finally {
    setBusy(form, false);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("registerMessage");
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  rememberedEmail = data.email;
  setBusy(form, true, "Hesap oluşturuluyor…");
  try {
    const result = await request("/v1/auth/register", { method: "POST", body: data });
    setMessage("verifyMessage", result?.message || "Doğrulama kodunu e-postana gönderdik.", "success");
    setView("verify");
  } catch (error) {
    setMessage("registerMessage", error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("verifyMessage");
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  rememberedEmail = data.email;
  setBusy(form, true, "Doğrulanıyor…");
  try {
    const result = await request("/v1/auth/verify-email", { method: "POST", body: data });
    setMessage("verifyMessage", result?.message || "E-posta doğrulandı. Şimdi giriş yapabilirsin.", "success");
    window.setTimeout(() => setView("login"), 1100);
  } catch (error) {
    setMessage("verifyMessage", error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

document.querySelector("#resendVerification").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const email = verifyForm.elements.email.value.trim();
  if (!email) {
    setMessage("verifyMessage", "Önce e-posta adresini gir.", "error");
    verifyForm.elements.email.focus();
    return;
  }
  button.disabled = true;
  try {
    const result = await request("/v1/auth/resend-verification", { method: "POST", body: { email } });
    setMessage("verifyMessage", result?.message || "Yeni doğrulama kodu gönderildi.", "success");
  } catch (error) {
    setMessage("verifyMessage", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("forgotMessage");
  const form = event.currentTarget;
  rememberedEmail = form.elements.email.value.trim();
  setBusy(form, true, "Gönderiliyor…");
  try {
    const result = await request("/v1/auth/request-password-reset", { method: "POST", body: { email: rememberedEmail } });
    setMessage("forgotMessage", result?.message || "Adres kayıtlıysa sıfırlama kodu gönderildi.", "success");
  } catch (error) {
    setMessage("forgotMessage", error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("resetMessage");
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.email = rememberedEmail || forgotForm.elements.email.value.trim();
  if (!data.email) {
    setMessage("resetMessage", "Önce e-posta adresini gir.", "error");
    return;
  }
  setBusy(form, true, "Güncelleniyor…");
  try {
    const result = await request("/v1/auth/reset-password", { method: "POST", body: data });
    setMessage("resetMessage", result?.message || "Parolan güncellendi. Giriş yapabilirsin.", "success");
    setTimeout(() => setView("login"), 1100);
  } catch (error) {
    setMessage("resetMessage", error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

skinInput.addEventListener("change", async () => {
  setSelectedFile(skinInput.files?.[0]);
  if (!selectedSkin) return;
  setMessage("skinMessage");
  try {
    await validatePngFile(selectedSkin, "skin");
    const image = await loadImage(previewUrl);
    skinViewer.loadSkin(image, { model: selectedModel === "slim" ? "slim" : "default" });
    drawAccountFace(image);
    document.querySelector("#uploadButton").disabled = false;
    setMessage("skinMessage", "Önizleme hazır. Değişikliği kaydetmek için skin yükle düğmesine bas.", "success");
  } catch (error) {
    setMessage("skinMessage", error.message, "error");
  }
});

skinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("skinMessage");
  try {
    await validatePngFile(selectedSkin, "skin");
  } catch (error) {
    setMessage("skinMessage", error.message, "error");
    return;
  }
  const uploadButton = document.querySelector("#uploadButton");
  uploadButton.disabled = true;
  uploadButton.textContent = "Yükleniyor…";
  const body = new FormData();
  body.append("skin", selectedSkin);
  try {
    await request("/v1/me/skin", {
      method: profile.skin ? "PUT" : "POST",
      auth: true,
      headers: { "X-Skin-Model": selectedModel },
      body,
    });
    selectedSkin = null;
    skinInput.value = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    setMessage("skinMessage", "Skinin başarıyla yüklendi.", "success");
    await loadProfile();
  } catch (error) {
    setMessage("skinMessage", error.message, "error");
  } finally {
    uploadButton.textContent = profile?.skin ? "Skinini güncelle" : "Skin yükle";
    uploadButton.disabled = true;
  }
});

document.querySelector("#skinModelSelect").addEventListener("change", async (event) => {
  selectedModel = event.currentTarget.value;
  if (profile) await renderProfileAppearance();
});

document.querySelector("#deleteSkinButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setMessage("skinMessage");
  try {
    await request("/v1/me/skin", { method: "DELETE", auth: true });
    await loadProfile();
    setMessage("skinMessage", "Skinin kaldırıldı.", "success");
  } catch (error) {
    setMessage("skinMessage", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

capeInput.addEventListener("change", async () => {
  const file = capeInput.files?.[0];
  if (!file) return;
  setMessage("capeMessage");
  if (capePreviewUrl) URL.revokeObjectURL(capePreviewUrl);
  capePreviewUrl = URL.createObjectURL(file);
  document.querySelector("#capeFileName").textContent = file.name;
  try {
    await validatePngFile(file, "cape");
    await setCapeTexture(capePreviewUrl);
    document.querySelector("#capeUploadButton").classList.remove("hidden");
    setMessage("capeMessage", "Önizleme hazır. Pelerini kaydetmek için yükle düğmesine bas.", "success");
  } catch (error) {
    setMessage("capeMessage", error.message, "error");
  }
});

document.querySelector("#capeUploadButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const file = capeInput.files?.[0];
  if (!file) return;
  try {
    await validatePngFile(file, "cape");
  } catch (error) {
    setMessage("capeMessage", error.message, "error");
    return;
  }
  const body = new FormData();
  body.append("cape", file);
  const buttonLabel = document.querySelector("#capeFileName");
  button.disabled = true;
  button.textContent = "Yükleniyor…";
  try {
    await request("/v1/me/cape", { method: profile.cape ? "PUT" : "POST", auth: true, body });
    if (capePreviewUrl) URL.revokeObjectURL(capePreviewUrl);
    capePreviewUrl = "";
    capeInput.value = "";
    setMessage("capeMessage", "Pelerinin başarıyla yüklendi.", "success");
    await loadProfile();
  } catch (error) {
    setMessage("capeMessage", error.message, "error");
  } finally {
    buttonLabel.textContent = profile?.cape ? "Pelerinini güncelle" : "PNG pelerin yükle";
    button.textContent = "Pelerini yükle";
    button.disabled = false;
  }
});

document.querySelector("#deleteCapeButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setMessage("capeMessage");
  try {
    await request("/v1/me/cape", { method: "DELETE", auth: true });
    await loadProfile();
    setMessage("capeMessage", "Pelerinin kaldırıldı.", "success");
  } catch (error) {
    setMessage("capeMessage", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#rotateToggle").addEventListener("click", (event) => {
  rotateEnabled = !rotateEnabled;
  skinViewer.autoRotate = rotateEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(rotateEnabled));
  event.currentTarget.querySelector("span:last-child").textContent = rotateEnabled ? "Dönüş açık" : "Dönüş kapalı";
});

document.querySelector("#animationToggle").addEventListener("click", (event) => {
  animationPaused = !animationPaused;
  if (skinViewer.animation) skinViewer.animation.paused = animationPaused;
  event.currentTarget.querySelector(".toggle-icon").textContent = animationPaused ? "▶" : "Ⅱ";
  event.currentTarget.querySelector("span:last-child").textContent = animationPaused ? "Oynat" : "Duraklat";
});

document.querySelector("#animationSelect").addEventListener("change", (event) => {
  const animations = {
    idle: skinview3d.IdleAnimation,
    walk: skinview3d.WalkingAnimation,
    run: skinview3d.RunningAnimation,
  };
  skinViewer.animation = new animations[event.currentTarget.value]();
  skinViewer.animation.speed = Number(document.querySelector("#animationSpeed").value);
  skinViewer.animation.paused = animationPaused;
});

document.querySelector("#animationSpeed").addEventListener("input", (event) => {
  const speed = Number(event.currentTarget.value);
  document.querySelector("#speedValue").textContent = `${speed.toFixed(1)}×`;
  if (skinViewer.animation) skinViewer.animation.speed = speed;
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  if (!window.confirm("Hesabından çıkış yapmak istediğine emin misin?")) return;
  let serverLogoutFailed = false;
  try {
    if (tokens().access) await request("/v1/auth/logout", { method: "POST", auth: true });
  } catch {
    serverLogoutFailed = true;
  }
  clearSession();
  accountSummary.classList.add("hidden");
  authCard.classList.remove("hidden");
  characterStudio.classList.add("hidden");
  characterLocked.classList.remove("hidden");
  setPage("account");
  setView("login");
  setMessage(
    "loginMessage",
    serverLogoutFailed
      ? "Bu cihazdaki oturum kapatıldı; sunucu bağlantısı olmadığı için oturum iptal edilemedi."
      : "Oturumun kapatıldı.",
    serverLogoutFailed ? "error" : "success",
  );
});

async function restoreSession() {
  if (!tokens().refresh) return;
  try {
    if (!await refreshSession()) return;
    await loadProfile();
    setPage("download");
  } catch {
    clearSession();
  }
}

checkApi();
scheduleSessionExpiry();
restoreSession();

package io.nocturne.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.NativeImage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.core.ClientAsset;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Iterator;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class WestronSkinManager {
    private static final Logger LOGGER = LoggerFactory.getLogger("Westron Client Skins");
    private static final URI API_ORIGIN = URI.create("https://westronskin.sytes.net");
    private static final URI MOJANG_API_ORIGIN = URI.create("https://api.mojang.com");
    private static final URI MOJANG_SESSION_ORIGIN = URI.create("https://sessionserver.mojang.com");
    private static final URI TLAUNCHER_ORIGIN = URI.create("https://auth.tlauncher.org");
    private static final URI MINECRAFT_TEXTURE_ORIGIN = URI.create("https://textures.minecraft.net");
    private static final int MAX_PROFILE_BYTES = 64 * 1024;
    private static final int MAX_SKIN_BYTES = 1024 * 1024;
    private static final long REFRESH_DELAY_MILLIS = Duration.ofMinutes(5).toMillis();
    private static final long RETRY_DELAY_MILLIS = Duration.ofMinutes(1).toMillis();
    private static final long NOT_FOUND_RETRY_DELAY_MILLIS = Duration.ofMinutes(5).toMillis();
    private static final ExecutorService IO_EXECUTOR = Executors.newFixedThreadPool(2, task -> {
        Thread thread = new Thread(task, "Westron skin API");
        thread.setDaemon(true);
        return thread;
    });
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private static final java.util.Map<String, SkinEntry> SKINS = new java.util.HashMap<>();
    private static Minecraft minecraft;
    private static String localMinecraftUsername;
    private static String localWestronUsername;

    private WestronSkinManager() {
    }

    public static void initialize() {
        minecraft = Minecraft.getInstance();
        loadLocalSkinIdentity();
    }

    public static PlayerSkin getSkin(GameProfile profile) {
        if (minecraft == null || profile == null) {
            return null;
        }

        String minecraftUsername = profile.name();
        String username = normalizeUsername(minecraftUsername);
        if (username == null) {
            return null;
        }

        String profileUsername = username.equals(localMinecraftUsername) && localWestronUsername != null
                ? localWestronUsername
                : username;
        SkinEntry entry;
        synchronized (SKINS) {
            entry = SKINS.computeIfAbsent(profileUsername, ignored -> new SkinEntry());
        }
        refreshIfNeeded(profileUsername, minecraftUsername, entry);
        return entry.skin;
    }

    private static void loadLocalSkinIdentity() {
        Path identityFile = minecraft.gameDirectory.toPath()
                .resolve("westron-skins")
                .resolve("local-player.properties");
        if (!Files.isRegularFile(identityFile)) {
            return;
        }
        Properties identity = new Properties();
        try (InputStream input = Files.newInputStream(identityFile)) {
            identity.load(input);
            localMinecraftUsername = normalizeUsername(identity.getProperty("minecraftUsername"));
            localWestronUsername = normalizeUsername(identity.getProperty("westronUsername"));
            if (localMinecraftUsername == null || localWestronUsername == null) {
                localMinecraftUsername = null;
                localWestronUsername = null;
                LOGGER.warn("The local Westron skin identity file is invalid.");
            }
        } catch (IOException exception) {
            LOGGER.warn("Could not read the local Westron skin identity file.");
        }
    }

    private static void refreshIfNeeded(String username, String minecraftUsername, SkinEntry entry) {
        synchronized (entry) {
            long now = System.currentTimeMillis();
            if (entry.inFlight || now < entry.retryAt) {
                return;
            }
            entry.inFlight = true;
        }

        IO_EXECUTOR.execute(() -> {
            try {
                if (!entry.cacheLoaded) {
                    loadCachedSkin(username, entry);
                    entry.cacheLoaded = true;
                }
                boolean found = refreshFromProviders(username, minecraftUsername, entry);
                entry.retryAt = System.currentTimeMillis()
                        + (found ? REFRESH_DELAY_MILLIS : NOT_FOUND_RETRY_DELAY_MILLIS);
            } catch (IOException | InterruptedException | IllegalStateException
                     | IllegalArgumentException | JsonParseException exception) {
                if (exception instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                entry.retryAt = System.currentTimeMillis() + RETRY_DELAY_MILLIS;
                LOGGER.warn("Skin provider update failed; the last cached skin remains available.");
            } finally {
                synchronized (entry) {
                    entry.inFlight = false;
                }
            }
        });
    }

    private static void loadCachedSkin(String username, SkinEntry entry) throws IOException {
        Path skinFile = skinFile(username);
        Path metadataFile = metadataFile(username);
        if (!Files.isRegularFile(skinFile) || Files.size(skinFile) > MAX_SKIN_BYTES
                || !Files.isRegularFile(metadataFile)) {
            return;
        }

        Properties metadata = new Properties();
        try (InputStream input = Files.newInputStream(metadataFile)) {
            metadata.load(input);
        }
        String model = metadata.getProperty("model");
        String updatedAt = metadata.getProperty("updatedAt");
        if (!isModel(model) || updatedAt == null || !isValidPng(Files.readAllBytes(skinFile))) {
            return;
        }

        entry.updatedAt = updatedAt;
        entry.etag = metadata.getProperty("etag");
        entry.provider = metadata.getProperty("provider", "westron");
        registerSkin(username, skinFile, model, entry);
    }

    private static boolean refreshFromProviders(String cacheUsername, String minecraftUsername, SkinEntry entry)
            throws IOException, InterruptedException {
        IOException lastFailure = null;
        try {
            if (refreshFromWestron(cacheUsername, entry)) {
                return true;
            }
        } catch (IOException exception) {
            lastFailure = exception;
        }
        try {
            if (refreshFromMojang(cacheUsername, minecraftUsername, entry)) {
                return true;
            }
        } catch (IOException exception) {
            lastFailure = exception;
        }
        try {
            if (refreshFromTLauncher(cacheUsername, minecraftUsername, entry)) {
                return true;
            }
        } catch (IOException exception) {
            lastFailure = exception;
        }

        if (lastFailure != null) {
            throw lastFailure;
        }
        clearSkin(cacheUsername, entry);
        return false;
    }

    private static boolean refreshFromWestron(String username, SkinEntry entry)
            throws IOException, InterruptedException {
        JsonObject profile = getJson(API_ORIGIN.resolve("/api/v1/profiles/" + username));
        if (profile == null) {
            return false;
        }
        JsonElement skinValue = profile.get("skin");
        if (skinValue == null || skinValue.isJsonNull() || !skinValue.isJsonObject()) {
            return false;
        }

        JsonObject skin = skinValue.getAsJsonObject();
        String model = requiredString(skin, "model");
        String updatedAt = requiredString(skin, "updatedAt");
        URI skinUri = parseUri(requiredString(skin, "url"));
        validateWestronSkinUri(username, skinUri);
        if (!isModel(model)) {
            throw new IOException("Unsupported Westron skin model.");
        }
        return downloadAndRegister(username, skinUri, model, updatedAt, "westron", entry);
    }

    private static boolean refreshFromMojang(String cacheUsername, String minecraftUsername, SkinEntry entry)
            throws IOException, InterruptedException {
        JsonObject user = getJson(MOJANG_API_ORIGIN.resolve("/users/profiles/minecraft/" + minecraftUsername));
        if (user == null) {
            return false;
        }
        String id = requiredString(user, "id").replace("-", "");
        if (!id.matches("(?i)[0-9a-f]{32}")) {
            throw new IOException("Mojang returned an invalid player UUID.");
        }
        String uuid = id.substring(0, 8) + "-" + id.substring(8, 12) + "-"
                + id.substring(12, 16) + "-" + id.substring(16, 20) + "-" + id.substring(20);
        JsonObject session = getJson(MOJANG_SESSION_ORIGIN.resolve(
                "/session/minecraft/profile/" + uuid + "?unsigned=false"));
        if (session == null) {
            return false;
        }
        JsonElement propertiesValue = session.get("properties");
        if (propertiesValue == null || !propertiesValue.isJsonArray()) {
            return false;
        }
        JsonArray properties = propertiesValue.getAsJsonArray();
        for (JsonElement propertyValue : properties) {
            if (!propertyValue.isJsonObject()) {
                continue;
            }
            JsonObject property = propertyValue.getAsJsonObject();
            if (!"textures".equals(stringValue(property, "name"))) {
                continue;
            }
            String encodedTextures = stringValue(property, "value");
            if (encodedTextures == null) {
                continue;
            }
            byte[] decoded;
            try {
                decoded = Base64.getDecoder().decode(encodedTextures);
            } catch (IllegalArgumentException exception) {
                throw new IOException("Mojang returned invalid skin metadata.", exception);
            }
            JsonObject textures = parseJsonObject(decoded);
            JsonElement texturesValue = textures.get("textures");
            if (texturesValue == null || !texturesValue.isJsonObject()) {
                return false;
            }
            JsonElement skinValue = texturesValue.getAsJsonObject().get("SKIN");
            if (skinValue == null || !skinValue.isJsonObject()) {
                return false;
            }
            JsonObject skin = skinValue.getAsJsonObject();
            URI skinUri = parseUri(requiredString(skin, "url"));
            validateMojangSkinUri(skinUri);
            String model = "classic";
            JsonElement metadataValue = skin.get("metadata");
            if (metadataValue != null && metadataValue.isJsonObject()
                    && "slim".equals(stringValue(metadataValue.getAsJsonObject(), "model"))) {
                model = "slim";
            }
            return downloadAndRegister(cacheUsername, skinUri, model, Instant.now().toString(), "mojang", entry);
        }
        return false;
    }

    private static boolean refreshFromTLauncher(String cacheUsername, String minecraftUsername, SkinEntry entry)
            throws IOException, InterruptedException {
        JsonObject profile = getJson(TLAUNCHER_ORIGIN.resolve(
                "/skin/profile/texture/login/" + minecraftUsername));
        if (profile == null) {
            return false;
        }
        JsonElement skinValue = profile.get("SKIN");
        if (skinValue == null || !skinValue.isJsonObject()) {
            return false;
        }

        JsonObject skin = skinValue.getAsJsonObject();
        URI skinUri = toSecureTLauncherUri(parseUri(requiredString(skin, "url")));
        String model = "classic";
        JsonElement metadataValue = skin.get("metadata");
        if (metadataValue != null && metadataValue.isJsonObject()
                && "slim".equals(stringValue(metadataValue.getAsJsonObject(), "model"))) {
            model = "slim";
        }
        return downloadAndRegister(cacheUsername, skinUri, model, Instant.now().toString(), "tlauncher", entry);
    }

    private static JsonObject getJson(URI uri) throws IOException, InterruptedException {
        HttpResponse<InputStream> response = HTTP.send(
                HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).GET().build(),
                HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream body = response.body()) {
            if (response.statusCode() == 204 || response.statusCode() == 404) {
                return null;
            }
            if (response.statusCode() != 200) {
                throw new IOException("A skin profile provider returned HTTP " + response.statusCode() + ".");
            }
            return parseJsonObject(readBounded(body, MAX_PROFILE_BYTES));
        }
    }

    private static JsonObject parseJsonObject(byte[] bytes) throws IOException {
        try {
            JsonElement parsed = JsonParser.parseString(
                    new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            if (!parsed.isJsonObject()) {
                throw new IOException("A skin provider returned an invalid profile.");
            }
            return parsed.getAsJsonObject();
        } catch (JsonParseException exception) {
            throw new IOException("A skin provider returned invalid JSON.", exception);
        }
    }

    private static String requiredString(JsonObject object, String key) throws IOException {
        String value = stringValue(object, key);
        if (value == null || value.isBlank()) {
            throw new IOException("A skin provider omitted required profile data.");
        }
        return value;
    }

    private static String stringValue(JsonObject object, String key) {
        JsonElement value = object.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
                ? value.getAsString()
                : null;
    }

    private static URI parseUri(String value) throws IOException {
        try {
            return URI.create(value);
        } catch (IllegalArgumentException exception) {
            throw new IOException("A skin provider returned an invalid URL.", exception);
        }
    }

    private static boolean downloadAndRegister(
            String cacheUsername, URI skinUri, String model, String updatedAt, String provider, SkinEntry entry)
            throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(skinUri)
                .timeout(Duration.ofSeconds(10))
                .GET();
        if (provider.equals(entry.provider) && entry.etag != null && !entry.etag.isBlank()) {
            request.header("If-None-Match", entry.etag);
        }
        HttpResponse<InputStream> response = HTTP.send(
                request.build(), HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() == 304 && Files.isRegularFile(skinFile(cacheUsername))) {
            try (InputStream ignored = response.body()) {
                entry.provider = provider;
                entry.updatedAt = updatedAt;
                persistMetadata(cacheUsername, entry);
            }
            return true;
        }

        byte[] png;
        try (InputStream body = response.body()) {
            if (response.statusCode() != 200) {
                throw new IOException("A skin image provider returned HTTP " + response.statusCode() + ".");
            }
            png = readBounded(body, MAX_SKIN_BYTES);
        }
        if (!isValidPng(png)) {
            throw new IOException("A skin image provider returned an unsupported PNG.");
        }

        String etag = response.headers().firstValue("ETag").orElse(null);
        persistSkin(cacheUsername, png, model, updatedAt, provider, etag);
        entry.updatedAt = updatedAt;
        entry.provider = provider;
        entry.etag = etag;
        registerSkin(cacheUsername, skinFile(cacheUsername), model, entry);
        return true;
    }

    private static URI toSecureTLauncherUri(URI skinUri) throws IOException {
        String scheme = skinUri.getScheme();
        int port = skinUri.getPort();
        String path = skinUri.getPath();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)
                || !TLAUNCHER_ORIGIN.getHost().equalsIgnoreCase(skinUri.getHost())
                || (port != -1 && port != 80 && port != 443)
                || skinUri.getUserInfo() != null
                || skinUri.getQuery() != null
                || skinUri.getFragment() != null
                || path == null
                || !path.startsWith("/skin/fileservice/skins/")
                || !path.endsWith(".png")) {
            throw new IOException("TLauncher returned an invalid skin URL.");
        }
        return URI.create("https://" + TLAUNCHER_ORIGIN.getHost() + path);
    }

    private static void validateWestronSkinUri(String username, URI skinUri) throws IOException {
        String expectedPath = "/api/v1/profiles/" + username + "/skin.png";
        if (!"https".equalsIgnoreCase(skinUri.getScheme())
                || !API_ORIGIN.getHost().equalsIgnoreCase(skinUri.getHost())
                || skinUri.getPort() != -1
                || !expectedPath.equalsIgnoreCase(skinUri.getPath())
                || skinUri.getUserInfo() != null
                || skinUri.getQuery() != null
                || skinUri.getFragment() != null) {
            throw new IOException("Westron returned an invalid skin URL.");
        }
    }

    private static void validateMojangSkinUri(URI skinUri) throws IOException {
        String path = skinUri.getPath();
        if (!"https".equalsIgnoreCase(skinUri.getScheme())
                || !MINECRAFT_TEXTURE_ORIGIN.getHost().equalsIgnoreCase(skinUri.getHost())
                || skinUri.getPort() != -1
                || skinUri.getUserInfo() != null
                || skinUri.getQuery() != null
                || skinUri.getFragment() != null
                || path == null
                || !path.startsWith("/texture/")) {
            throw new IOException("Mojang returned an invalid skin URL.");
        }
    }

    private static void persistSkin(
            String username, byte[] png, String model, String updatedAt, String provider, String etag)
            throws IOException {
        Path directory = cacheDirectory();
        Files.createDirectories(directory);
        Path skinTemp = Files.createTempFile(directory, username, ".png.tmp");
        Path metadataTemp = Files.createTempFile(directory, username, ".properties.tmp");
        try {
            Files.write(skinTemp, png);
            Properties metadata = new Properties();
            metadata.setProperty("model", model);
            metadata.setProperty("updatedAt", updatedAt);
            metadata.setProperty("provider", provider);
            if (etag != null && !etag.isBlank()) {
                metadata.setProperty("etag", etag);
            }
            try (var output = Files.newOutputStream(metadataTemp)) {
                metadata.store(output, null);
            }
            Files.move(skinTemp, skinFile(username), StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
            Files.move(metadataTemp, metadataFile(username), StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(skinTemp);
            Files.deleteIfExists(metadataTemp);
        }
    }

    private static void persistMetadata(String username, SkinEntry entry) throws IOException {
        Properties metadata = new Properties();
        metadata.setProperty("model", entry.model);
        metadata.setProperty("updatedAt", entry.updatedAt);
        metadata.setProperty("provider", entry.provider);
        if (entry.etag != null && !entry.etag.isBlank()) {
            metadata.setProperty("etag", entry.etag);
        }
        try (var output = Files.newOutputStream(metadataFile(username))) {
            metadata.store(output, null);
        }
    }

    private static void registerSkin(String username, Path skinFile, String model, SkinEntry entry) {
        byte[] skinBytes;
        try {
            skinBytes = Files.readAllBytes(skinFile);
        } catch (IOException exception) {
            LOGGER.warn("Could not read a cached Westron skin texture.");
            return;
        }
        Identifier textureId = Identifier.fromNamespaceAndPath(
                "westron", "skins/" + username + "_" + skinHash(skinBytes, model));
        ClientAsset.ResourceTexture texture = new ClientAsset.ResourceTexture(textureId);
        PlayerModelType playerModel = model.equals("slim") ? PlayerModelType.SLIM : PlayerModelType.WIDE;
        entry.model = model;
        entry.targetTextureId = textureId;
        Minecraft client = minecraft;
        if (client == null) {
            return;
        }
        CompletableFuture.supplyAsync(() -> decodeSkin(skinFile), IO_EXECUTOR)
                .whenComplete((image, error) -> {
                    if (error != null) {
                        LOGGER.warn("Minecraft could not decode a Westron skin texture.");
                        return;
                    }
                    client.execute(() -> {
                        if (!textureId.equals(entry.targetTextureId)) {
                            image.close();
                            return;
                        }
                        try {
                            DynamicTexture dynamicTexture = new DynamicTexture(
                                    () -> "Westron skin: " + username, image);
                            client.getTextureManager().register(texture.texturePath(), dynamicTexture);
                            PlayerSkin playerSkin = PlayerSkin.insecure(texture, null, null, playerModel);
                            PlayerSkin previous = entry.skin;
                            entry.skin = playerSkin;
                            if (previous != null && previous.body() != null
                                    && !texture.texturePath().equals(previous.body().texturePath())) {
                                client.getTextureManager().release(previous.body().texturePath());
                            }
                        } catch (RuntimeException exception) {
                            image.close();
                            LOGGER.warn("Minecraft could not register a Westron skin texture.");
                        }
                    });
                });
    }

    private static NativeImage decodeSkin(Path skinFile) {
        try (InputStream input = Files.newInputStream(skinFile)) {
            NativeImage image = NativeImage.read(input);
            if (image.getWidth() == 64 && image.getHeight() == 32) {
                return convertLegacySkin(image);
            }
            if (image.getWidth() == 64 && image.getHeight() == 64) {
                return image;
            }
            image.close();
            throw new IllegalArgumentException("Unsupported Minecraft skin dimensions.");
        } catch (IOException exception) {
            throw new CompletionException(exception);
        }
    }

    private static NativeImage convertLegacySkin(NativeImage legacy) {
        NativeImage image = new NativeImage(64, 64, true);
        try {
            image.copyFrom(legacy);
        } finally {
            legacy.close();
        }
        image.fillRect(0, 32, 64, 32, 0);
        image.copyRect(4, 16, 16, 32, 4, 4, true, false);
        image.copyRect(8, 16, 16, 32, 4, 4, true, false);
        image.copyRect(0, 20, 24, 32, 4, 12, true, false);
        image.copyRect(4, 20, 16, 32, 4, 12, true, false);
        image.copyRect(8, 20, 8, 32, 4, 12, true, false);
        image.copyRect(12, 20, 0, 32, 4, 12, true, false);
        image.copyRect(44, 16, -8, 32, 4, 4, true, false);
        image.copyRect(48, 16, -8, 32, 4, 4, true, false);
        image.copyRect(40, 20, 0, 32, 4, 12, true, false);
        image.copyRect(44, 20, -8, 32, 4, 12, true, false);
        image.copyRect(48, 20, -16, 32, 4, 12, true, false);
        image.copyRect(52, 20, -8, 32, 4, 12, true, false);
        setNoAlpha(image, 0, 0, 32, 16);
        if (isOpaque(image, 32, 0, 64, 32)) {
            removeAlpha(image, 32, 0, 64, 32);
        }
        setNoAlpha(image, 0, 16, 64, 32);
        setNoAlpha(image, 16, 48, 48, 64);
        return image;
    }

    private static void setNoAlpha(NativeImage image, int left, int top, int right, int bottom) {
        for (int x = left; x < right; x++) {
            for (int y = top; y < bottom; y++) {
                image.setPixel(x, y, image.getPixel(x, y) | 0xFF000000);
            }
        }
    }

    private static boolean isOpaque(NativeImage image, int left, int top, int right, int bottom) {
        for (int x = left; x < right; x++) {
            for (int y = top; y < bottom; y++) {
                if ((image.getPixel(x, y) >>> 24) < 128) {
                    return false;
                }
            }
        }
        return true;
    }

    private static void removeAlpha(NativeImage image, int left, int top, int right, int bottom) {
        for (int x = left; x < right; x++) {
            for (int y = top; y < bottom; y++) {
                image.setPixel(x, y, image.getPixel(x, y) & 0x00FFFFFF);
            }
        }
    }

    private static void clearSkin(String username, SkinEntry entry) throws IOException {
        PlayerSkin previous = entry.skin;
        entry.skin = null;
        entry.etag = null;
        entry.updatedAt = null;
        entry.model = null;
        entry.provider = null;
        entry.targetTextureId = null;
        Files.deleteIfExists(skinFile(username));
        Files.deleteIfExists(metadataFile(username));
        Minecraft client = minecraft;
        if (client != null && previous != null && previous.body() != null) {
            client.execute(() -> client.getTextureManager().release(previous.body().texturePath()));
        }
    }

    private static String skinHash(byte[] skinBytes, String model) {
        try {
            MessageDigest hasher = MessageDigest.getInstance("SHA-256");
            hasher.update(skinBytes);
            byte[] digest = hasher.digest(model.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest, 0, 8);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

    private static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        byte[] bytes = input.readNBytes(maxBytes + 1);
        if (bytes.length > maxBytes) {
            throw new IOException("Response exceeded its size limit.");
        }
        return bytes;
    }

    private static boolean isValidPng(byte[] bytes) {
        if (bytes.length < 24 || bytes.length > MAX_SKIN_BYTES
                || bytes[0] != (byte) 0x89 || bytes[1] != 'P' || bytes[2] != 'N' || bytes[3] != 'G'
                || bytes[4] != 0x0D || bytes[5] != 0x0A || bytes[6] != 0x1A || bytes[7] != 0x0A) {
            return false;
        }
        try (ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) {
                return false;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                if (!"png".equalsIgnoreCase(reader.getFormatName())) {
                    return false;
                }
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (!((width == 64 && height == 64) || (width == 64 && height == 32))) {
                    return false;
                }
                var image = reader.read(0);
                if (image == null) {
                    return false;
                }
                image.flush();
                return true;
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException exception) {
            return false;
        }
    }

    private static boolean isModel(String model) {
        return "classic".equals(model) || "slim".equals(model);
    }

    private static String normalizeUsername(String username) {
        if (username == null || !username.matches("[A-Za-z0-9_]{3,16}")) {
            return null;
        }
        return username.toLowerCase(Locale.ROOT);
    }

    private static Path cacheDirectory() {
        return minecraft.gameDirectory.toPath().resolve("westron-skins");
    }

    private static Path skinFile(String username) {
        return cacheDirectory().resolve(username + ".png");
    }

    private static Path metadataFile(String username) {
        return cacheDirectory().resolve(username + ".properties");
    }

    private static final class SkinEntry {
        private volatile PlayerSkin skin;
        private volatile String etag;
        private volatile String updatedAt;
        private volatile String model;
        private volatile String provider;
        private volatile Identifier targetTextureId;
        private volatile long retryAt;
        private volatile boolean cacheLoaded;
        private boolean inFlight;
    }

}

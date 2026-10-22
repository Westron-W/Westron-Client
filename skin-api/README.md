# Westron Skin API

Fastify tabanlı, mevcut web sitesinden ve Microsoft/Minecraft girişinden ayrı bir Westron hesabı ve skin servisidir. Bu API'nin hesabı bir Minecraft hesabının sahipliğini kanıtlamaz. E-posta doğrulanmamış hesaplar skin işlemlerini kullanamaz.

## API

| Method | Endpoint | Açıklama |
| --- | --- | --- |
| `GET` | `/api/health` | API ve SQLite sağlık kontrolü |
| `POST` | `/api/v1/auth/register` | `{ username, email, password }` ile hesap açar ve doğrulama e-postası gönderir |
| `POST` | `/api/v1/auth/verify-email` | `{ email, token }` ile tek kullanımlık e-posta kodunu doğrular |
| `POST` | `/api/v1/auth/resend-verification` | `{ email }` için güvenli doğrulama e-postası yenileme isteği |
| `POST` | `/api/v1/auth/login` | `{ email, password }` ile access/refresh token alır |
| `POST` | `/api/v1/auth/refresh` | `{ refreshToken }` ile refresh token rotasyonu yapar |
| `POST` | `/api/v1/auth/logout` | Bearer token'ın oturumunu iptal eder |
| `POST` | `/api/v1/auth/request-password-reset` | `{ email }` için parola sıfırlama e-postası ister |
| `POST` | `/api/v1/auth/reset-password` | `{ email, token, newPassword }` ile parolayı değiştirir ve tüm oturumları kapatır |
| `GET` | `/api/v1/me` | Kimliği doğrulanmış kullanıcının profili |
| `POST` / `PUT` / `DELETE` | `/api/v1/me/skin` | İlk skin yükleme / değiştirme / silme |
| `GET` | `/api/v1/profiles/{username}` | Herkese açık oyuncu profili ve skin modeli |
| `GET` | `/api/v1/profiles/{username}/skin.png` | Herkese açık PNG skin; ETag cache desteği |
| `GET` | `/api/openapi.yaml` | Gerçek route'larla eşleştirilmiş OpenAPI 3.1 |

Skin istekleri multipart/form-data içindeki `skin` alanıyla yüklenir. PNG imzası ve içerik dekoderi kontrol edilir; yalnızca 64x64 veya 64x32 piksel ve en fazla 1 MiB kabul edilir. `X-Skin-Model` isteğe bağlı `classic`/`slim` başlığıdır. Hesap parolaları Argon2id, e-posta doğrulama/parola sıfırlama kodları yalnızca SHA-256 özetiyle tutulur. Access ve refresh token'lar da veritabanında yalnızca hash olarak saklanır; refresh token rotasyonu eski token tekrar kullanımında oturumu iptal eder.

## Yerel geliştirme ve test

Node.js 22.12+ gerekir. SMTP kullanmadan test için testler sahte mailer enjekte eder:

```powershell
npm.cmd --prefix .\skin-api ci
npm.cmd --prefix .\skin-api test
```

Gerçek yerel sunucuyu başlatmak için `skin-api/.env` dosyasını oluşturup SMTP ayarlarını girin. Gerçek uygulama şifresini kaynak koda veya launcher'a koymayın:

```powershell
Copy-Item .\skin-api\.env.example .\skin-api\.env
# skin-api\.env dosyasında NPM_DOCKER_NETWORK ve SMTP değerlerini düzenleyin
npm.cmd --prefix .\skin-api start
```

`SMTP_PASSWORD` Gmail uygulama şifresidir ve yalnızca sunucu ortamında bulunmalıdır. `.env` ve `.env.*` Git dışında tutulur; `.env.example` yalnızca örnek yer tutucular içerir. E-posta teslimi sınırlı sayıda yeniden denenir; SMTP hata mesajları veya kimlik bilgileri istemciye/loglara yazılmaz.

## Ubuntu VDS Docker kurulumu — kullanıcı tarafından uygulanacak

VDS'ye, Docker'a veya Nginx Proxy Manager'a bu geliştirme sırasında erişilmedi; kurulum, mevcut yönlendirme ve portların gerçekten incelenmesi ve yedek alınması kullanıcı tarafından yapılmalıdır. Mevcut web sitesi, sertifika, Crafty ve container'ları silmeyin/değiştirmeyin.

1. VDS'de mevcut container, port ve ağ durumunu salt okunur şekilde kaydedin; mevcut web site/NPM konfigürasyonunu yedekleyin:

   ```bash
   docker ps --format 'table {{.Names}}\t{{.Ports}}'
   docker network ls
   docker inspect <NPM_CONTAINER_ADI> --format '{{json .NetworkSettings.Networks}}'
   ```

   `/opt/westron/skin-api` altında yalnızca bu servisin dosyalarını kopyalayın. NPM'nin zaten kullandığı ağı ve `westronskin.sytes.net` için mevcut Proxy Host/custom location kurallarını inceleyin. NPM ağı yoksa durun ve önce yönlendirme planını belirleyin; bu Compose yeni bir ağ yaratmaz.

2. Yedek ve geri dönüş planı: Mevcut kök web hedefi, proxy konfigürasyonu, sertifika ve Crafty verileri için kurulum öncesinde ayrı yedek alın. API volume'ü için ilk kurulumdan sonra aşağıdaki yedek komutlarını kullanın. Sorun halinde API servisini durdurup yalnızca yeni API Proxy Location'ını kaldırın; kök host, mevcut web servisi, sertifika ve Crafty üzerinde değişiklik yapmayın. API volume'ünü silmeyin.

3. `skin-api` dizininde `.env` oluşturun ve örnek değerleri gerçek özel bilgileri buraya koymadan, VDS üzerinde düzenleyin:

   ```bash
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```

   `NPM_DOCKER_NETWORK` mevcut NPM ağının gerçek adı olmalı. Gmail için `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_FROM` ve Google uygulama şifresini `SMTP_PASSWORD` olarak ayarlayın. E-posta adresi/proxy yapılandırmasına ihtiyaç yoksa `CORS_ORIGINS` boş kalsın. `TRUST_PROXY` değerini NPM'nin gerçek container IP'si veya güvenilir Docker subnet CIDR'ıyla sınırlayın; `true` kullanmayın.

4. Compose API container'ını yalnızca mevcut NPM Docker ağına bağlar. Host `ports` eşlemesi yoktur; yeni internet portu açılmaz. SQLite ve PNG dosyaları named volume `skin-api-data` içinde kalıcıdır:

   ```bash
   docker compose config
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 westron-skin-api
   ```

5. NPM'deki var olan domain ve HTTPS sertifikasını koruyun. Domain'in kök (`/`) hedefini değiştirmeden yalnızca `/api/` için Custom Location ekleyin: scheme `http`, forward hostname `westron-skin-api`, port `3000`. Custom Location `/api` prefix'ini backend'e koruyarak geçirmeli. Aynı domain'de `/api` başka servisçe kullanılıyorsa mevcut yönlendirmeyi değiştirmeyin; önce ayrı host/path kararı verin. Ardından:

   ```bash
   docker compose exec westron-skin-api node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"
   curl --fail https://westronskin.sytes.net/api/health
   curl --fail https://westronskin.sytes.net/api/openapi.yaml
   ```

   Health yanıtı `{"status":"ok"}` olmalıdır. Domain'in kök sayfasının kurulum öncesi davranışını ayrıca doğrulayın.

Güncelleme kurulum dosyaları büyük olduğundan API sunucusu en fazla 90 dakikalık yavaş HTTP isteklerine izin verecek şekilde yapılandırılmıştır. Bu kod değiştiğinde VDS'de API imajını yeniden derleyip servisi yeniden oluşturun; Nginx Proxy Manager üzerinden `/api/` isteği için kullanılan `client_body_timeout` ve `proxy_read_timeout` ayarlarının da uzun yüklemelere izin verdiğini kontrol edin.

### Yedekleme ve geri yükleme

Compose'un gerçek volume adını `docker volume ls` ile belirleyin; varsayılan proje dizin adı `skin-api` ise genellikle `skin-api_skin-api-data` olur. Tutarlı dosya kopyası için yalnız API container'ını durdurup, yedek aldıktan sonra yeniden başlatın:

```bash
docker compose stop westron-skin-api
docker run --rm -v skin-api_skin-api-data:/data:ro -v /opt/backups:/backup alpine \
  tar -czf /backup/westron-skin-api-$(date +%F-%H%M%S).tar.gz -C /data .
docker compose start westron-skin-api
```

Geri yükleme için önce mevcut volume'ün ayrıca yedeğini alın. API servisini durdurun, arşiv adını ve **doğru named volume adını** doğrulayarak dosyaları geri açın, sonra servisi başlatıp `/api/health` ve profilleri kontrol edin:

```bash
docker compose stop westron-skin-api
docker run --rm -v skin-api_skin-api-data:/data -v /opt/backups:/backup alpine \
  tar -xzf /backup/westron-skin-api-YYYY-MM-DD-HHMMSS.tar.gz -C /data
docker compose start westron-skin-api
curl --fail https://westronskin.sytes.net/api/health
```

Örnek volume ve dosya adlarını gerçek değerlerle değiştirin. Arşiv mevcut dosyaların üzerine yazar; `docker compose down -v` ile volume'ü silmeyin.

## Minecraft ve launcher entegrasyonu

Backend'in skin çalışması, oyunda diğer oyuncuların özel skinlerinin gösterilmesinden ayrıdır. `fabric-mod` içindeki istemci modu, Minecraft 26.3 `AbstractClientPlayer.getSkin()` yoluna client-only Mixin uygular. Launcher, Minecraft'ta seçili yerel oyun adını ve oturum açmış Westron hesabının kullanıcı adını `westron-skins/local-player.properties` dosyasına yazar; böylece bu iki ad farklı olsa da yerel oyuncu Westron skin profilini kullanır. Diğer oyuncular için kaynak sırası Westron API, orijinal Minecraft profili ve TLauncher profil servisidir. TLauncher profil JSON'unda görsel adresi HTTP olarak dönse bile yalnızca izin verilen TLauncher host/path doğrulandıktan sonra HTTPS üzerinden istenir. Oyuncu adları herkese açık profil sorguları için bu servislere gönderilir. PNG'ler ve son geçerli model `westron-skins` içinde önbelleğe alınır; her oyuncu beş dakikada bir yenilenir, geçici ağ hatalarında cache korunur. PNG, arka plan iş parçacığında Minecraft `NativeImage` ile çözülür; `DynamicTexture` ana render thread'inde `ResourceTexture.texturePath()` altında texture manager'a kaydedilir. Minecraft 26.3 `SkinTextureDownloader` metodu HTTP bağlantısı istediğinden yerel `file:` cache URL'siyle kullanılmaz. 64x32 legacy skinler Minecraft 26.3 bytecode'unda incelenen kopyalama ve alpha işlemleriyle 64x64 texture'a dönüştürülür. Classic ve slim modelleri desteklenir. Sunucu eklentisi gerekmez; ancak skinleri görmek için sunucuya bağlanan her oyuncunun Westron Fabric istemci modunu kullanması gerekir. Modsuz istemciler custom skinleri göremez. TLauncher profil servisi resmi ve kararlı bir API olarak belgelenmemiştir; servis yanıtı değişirse Mojang ve Westron kaynakları çalışmaya devam eder. Microsoft hesabına skin yüklenmez veya hesabın mevcut skini değiştirilmez.

Launcher Ayarlar ekranında Westron hesabı kaydı, doğrulama, giriş, parola sıfırlama, çıkış ve kendi skinini yükleme arayüzü bulunur. Electron ana süreci access/refresh token'larını işletim sisteminin `safeStorage` deposuyla şifreler; bu Westron hesabı Minecraft oyun oturumu sağlamaz ve mevcut çevrimdışı başlatmayı değiştirmez.

Önemli sınırlama: mevcut repo analizinde Microsoft giriş akışı bulunmadı; launcher şu anda çevrimdışı Minecraft başlatıyor. Microsoft hesabıyla oyun girişi eklenmedi. Önceki analizde minecraft-kit'in Microsoft→Xbox/XSTS→Minecraft akışı görüldü ancak MSAL token'ından Minecraft oyun oturumu üretme yöntemi doğrulanmadı. Bu nedenle Microsoft login korunmuş veya MSAL entegrasyonu çalışıyor denemez. Microsoft client secret launcher'a eklenmemelidir.

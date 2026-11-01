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
| `POST` / `PUT` / `DELETE` | `/api/v1/me/cape` | Pelerin yükleme / değiştirme / silme |
| `GET` | `/api/v1/profiles/{username}` | Herkese açık oyuncu profili ve skin modeli |
| `GET` | `/api/v1/profiles/{username}/skin.png` | Herkese açık PNG skin; ETag cache desteği |
| `GET` | `/api/v1/profiles/{username}/cape.png` | Herkese açık PNG pelerin; ETag cache desteği |
| `GET` | `/api/openapi.yaml` | Gerçek route'larla eşleştirilmiş OpenAPI 3.1 |

Skin istekleri multipart/form-data içindeki `skin` alanıyla yüklenir. PNG imzası ve içerik dekoderi kontrol edilir; yalnızca 64x64 veya 64x32 piksel ve en fazla 1 MiB kabul edilir. `X-Skin-Model` isteğe bağlı `classic`/`slim` başlığıdır. Hesap parolaları Argon2id, e-posta doğrulama/parola sıfırlama kodları yalnızca SHA-256 özetiyle tutulur. Access ve refresh token'lar da veritabanında yalnızca hash olarak saklanır; refresh token rotasyonu eski token tekrar kullanımında oturumu iptal eder.

Herkese açık skin ve pelerin PNG uç noktaları WebGL tabanlı 3D önizleyicilerin dokuları canvas'a yükleyebilmesi için `Access-Control-Allow-Origin: *` döndürür; bu yalnızca herkese açık salt-okunur görsel rotalarına uygulanır.

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

### Pelerin yükleme 404 hatası

Launcher'da `POST` (ilk yükleme) ve `PUT` (değiştirme) `/api/v1/me/cape` uç noktaları kullanılır. Bu uç noktalar bu depodaki API kodunda tanımlıdır; canlı alan adından alınan 404, çalışan VDS container'ının eski bir API sürümü kullandığı veya `/api/` proxy yönlendirmesinin farklı servise gittiği anlamına gelir. Launcher güncellemesi tek başına canlı API'yi güncellemez; VDS'ye bu deponun güncel `skin-api` kaynaklarını aktarın.

Önce `skin-api-data` volume'ünü yedekleyin ve yukarıdaki mevcut NPM/ağ/yönlendirme yapılandırmasını değiştirmeyin. Kaynakları VDS'ye aktardıktan sonra `skin-api` dizininde yalnızca API imajını yeniden oluşturup başlatın:

```bash
docker compose up -d --build westron-skin-api
docker compose ps
curl --fail https://westronskin.sytes.net/api/openapi.yaml
```

OpenAPI yanıtında `/api/v1/me/cape` için `post`, `put` ve `delete` metotlarını doğrulayın. Ardından geçerli bir PNG dosyasıyla yetkisiz POST ve PUT isteklerinin `401` verdiğini kontrol edin; `404` olmamalıdır. `PNG_DOSYASI` yer tutucusunu sunucuda bulunan gerçek bir PNG dosyasının yoluyla değiştirin:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -F 'cape=@PNG_DOSYASI' https://westronskin.sytes.net/api/v1/me/cape
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -F 'cape=@PNG_DOSYASI' https://westronskin.sytes.net/api/v1/me/cape
```

Herhangi biri `404` döndürürse proxy/route deployment'ı hâlâ eski veya yanlış hedefe yöneliyordur. Bu doğrulama başarılı olmadan pelerin yüklemesinin canlı serviste düzeldiği varsayılmamalıdır.

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

Backend'in skin/pelerin depolaması, oyunda diğer oyuncuların özel görünümlerinin gösterilmesinden ayrıdır. `fabric-mod` içindeki istemci modu, Minecraft 26.3 oyuncu görünümü yoluna client-only Mixin uygular ve Westron API'den skin ile pelerini yükler. Launcher, yerel oyuncu için farklı Minecraft ve Westron adlarını eşleştirebilir; diğer oyuncu istemcileri ise profili oyun adıyla aradığından Westron kullanıcı adıyla aynı oyun adı kullanılmalıdır. Diğer oyuncular için kaynak sırası Westron API, orijinal Minecraft profili ve desteklenen diğer herkese açık profil servisleridir. Oyuncu adları herkese açık profil sorguları için bu servislere gönderilir. Skin ve pelerin dosyaları `westron-skins` içinde önbelleğe alınır; geçici ağ hatalarında son geçerli görünüm korunur. Sunucu eklentisi gerekmez; ancak Westron görünümünü başka launcher kullanan oyunculara göstermek için oyuncuların Westron Fabric istemci modunu uyumlu profillerinin `mods` klasörüne eklemesi gerekir. Modsuz istemciler özel skin ve pelerinleri göremez. Westron yüklemesi Microsoft hesabındaki skini veya pelerini değiştirmez.

Launcher'ın **Skin & Pelerin** ekranında Westron hesabı kaydı, doğrulama, giriş, parola sıfırlama, çıkış ve skin/pelerin yükleme arayüzü bulunur. Electron ana süreci access/refresh token'larını işletim sisteminin `safeStorage` deposuyla şifreler; bu Westron hesabı Minecraft oyun oturumu sağlamaz ve oyun giriş yöntemini değiştirmez.

Önemli sınırlama: mevcut repo analizinde Microsoft giriş akışı bulunmadı; launcher şu anda çevrimdışı Minecraft başlatıyor. Microsoft hesabıyla oyun girişi eklenmedi. Önceki analizde minecraft-kit'in Microsoft→Xbox/XSTS→Minecraft akışı görüldü ancak MSAL token'ından Minecraft oyun oturumu üretme yöntemi doğrulanmadı. Bu nedenle Microsoft login korunmuş veya MSAL entegrasyonu çalışıyor denemez. Microsoft client secret launcher'a eklenmemelidir.

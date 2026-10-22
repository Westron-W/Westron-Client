# Westron Client

Windows için koyu temalı, Fabric ve Minecraft 26.3 odaklı masaüstü launcher.

## Geliştirme

- Node.js 22.12 veya üzeri
- JDK 25 veya üzeri (oyun içi Fabric modunu derlemek için)

Fabric kurulumundan sonra oyunu Microsoft hesabınla veya ayrı bir çevrimdışı kullanıcı adıyla başlatabilirsin. Microsoft akışı sistem tarayıcısında Authorization Code + PKCE kullanır; Minecraft Java profili ve oyun erişimi doğrulanmadan çevrimiçi oturum başlatılmaz. Çevrimdışı oturum tek oyunculu ve offline-mode sunucular içindir. Minecraft 26.3, Fabric, gerekli oyun dosyaları ve Java çalışma zamanı ilk kurulum/başlatma sırasında otomatik hazırlanır.

### Microsoft uygulama kaydı

Microsoft girişi için kendi Microsoft Entra/Azure uygulama kaydının **Application (client) ID** değerini edin ve launcher çalışırken `MINECRAFT_KIT_MSA_CLIENT_ID` ortam değişkeni olarak tanımla. Uygulamayı geliştirme terminalinden başlatırken:

```powershell
$env:MINECRAFT_KIT_MSA_CLIENT_ID = '<uygulama-client-id>'
npm.cmd run dev
```

Kurulu launcher için değeri Windows kullanıcı ortam değişkeni olarak kaydedebilirsin:

```powershell
[Environment]::SetEnvironmentVariable('MINECRAFT_KIT_MSA_CLIENT_ID', '<uygulama-client-id>', 'User')
```

Uygulama kaydında **Mobile and desktop applications** platformunu kullan ve `http://localhost` loopback redirect URI'sini kaydet. Giriş sırasında istemci geçici bir yerel port açar ve gerçek OAuth redirect URI'si `http://localhost:<rastgele-port>` olur (dönüş yolu `/`); Authorization Code + PKCE sistem tarayıcısında bu adresle tamamlanır. Microsoft'un loopback yönlendirmesi değişken portu desteklediğinden sabit porta veya özel URI şemasına gerek yoktur. Windows kullanıcı ortam değişkeninin yeni uygulama süreçlerine aktarılması için oturumu kapatıp yeniden aç; istersen launcher'ı ortam değişkenini içeren yeni bir terminalden de başlatabilirsin. İstemci masaüstü uygulaması olarak **client secret kullanmaz; oluşturma veya ekleme**. Gerçek bir Client ID kaynak koduna eklenmemiştir.

```powershell
npm.cmd install
npm.cmd run build:mod
npm.cmd run dev
```

Üretim derlemesi ve Windows kurulum dosyası (`JAVA_HOME` JDK 25'i göstermelidir):

```powershell
npm.cmd run package
```

## Özellikler

- Fabric Loader'ı Fabric Meta API'sinden indirip Minecraft 26.3 oyun dizinine kurar; önceden indirilmiş bir oyun sürümü şartı yoktur.
- İndirme kaynakları geçici olarak erişilemediğinde ASM analiz kütüphanesi için doğrulanmış Maven Central yedeğini kullanır; dosyayı SHA-1 ve boyutla doğrular.
- Oyun içi duraklatma ekranını değiştiren Westron Client Fabric modunu ve Fabric API'yi birlikte kurar.
- Microsoft → Xbox Live → XSTS → Minecraft kimlik doğrulamasını ve Java profili/oyun sahipliği kontrolünü uygular; yenileme bilgilerini Windows güvenli depolamasında tutar.
- Microsoft hesabından bağımsız Westron hesabıyla skin yüklemeyi destekler. İstemci modu sırasıyla Westron API, orijinal Minecraft profili ve TLauncher profillerinden skin alır; sunucuya eklenti kurulması gerekmez ve Microsoft hesabının skini değiştirilmez. Skinlerin görünmesi için oyuncuların Westron Fabric istemci modunu kullanması gerekir.
- Fabric ve Minecraft 26.3 uyumlu modları Modrinth'te arar; zorunlu bağımlılıkları indirmeden önce listeler ve onaydan sonra birlikte kurar.
- Mod menüsünden ayrı olarak Modrinth kaynak paketi ve shader paketlerini en yeni Minecraft 26.3 uyumlu sürümleriyle kurar, hash doğrular ve eski Westron-yönetimli sürümü günceller. Shader çalıştırmak için Iris 26.3 Fabric altyapısını kurma olanağı sağlar.
- Yüklü JAR modlarını listeler, kaldırır ve oyun klasörünü açar.
- Sunucu adresini doğrulayıp panoya kopyalar; oyun içinde çok oyunculu menüsünden bağlanılır.

Fabric kurulumu tamamlanınca Westron Client modu da `mods` klasörüne eklenir. Oyun içindeki ESC tuşu koyu özel menüyü açar; mod menüsünden mevcut Fabric mod sayısını görebilir ve oyun ayarlarına geçebilirsin.

## Westron Skin API

Microsoft/Minecraft Launcher kimlik doğrulamasından bağımsız skin servisi backend'i [`skin-api/`](./skin-api/) dizinindedir. Kurulum, Docker/Nginx Proxy Manager ayarları, API endpoint'leri ve test komutları için [skin-api/README.md](./skin-api/README.md) dosyasına bakın. Fabric istemci modülü oyuncuların Westron Skin API skinlerini, orijinal Minecraft profillerini ve TLauncher skinlerini istemci tarafında yükler; skin PNG'lerini güvenli HTTPS üzerinden alıp yerel olarak önbelleğe alır. Sunucuya eklenti gerekmez; sunucuya bağlanan her oyuncunun istemcisinde Westron Fabric modu olmalıdır. Modsuz Minecraft istemcileri özel skinleri göremez. Westron skin yüklemek Microsoft hesabındaki skini değiştirmez.

## Sürüm numaraları

Kullanıcı arayüzünde ve Windows kurulum dosyasında ürün sürümü `1.0` gösterilir; Fabric skin modunun JAR sürümü de `1.0`'dır. Otomatik güncelleme sıralamasını mevcut kurulumlardan geriye düşürmemek için paket SemVer sürümü `1.0.7` olarak ilerletilir. Kurulum dosyası `release/Westron Client Setup 1.0.exe` adını alır.

Güncelleme yayımlama alanında, `npm run package` komutuyla oluşturulan `release/` klasörünü seçin. Kurulum dosyası `Westron Client Setup 1.0.exe`, `.blockmap` ve `latest.yml` aynı klasörde bulunmalıdır; uygulama klasördeki üç dosyayı birlikte okuyup yayımlar. Büyük kurulum dosyaları için yükleme zaman aşımı dosya boyutuna göre en fazla 90 dakikaya çıkarılır. Kurulum sihirbazı Windows'un yerleşik kurulum adımlarını, Westron başlık ve kenar görselleriyle kullanır.

## Modrinth paketleri

Sol menüden **Kaynak paketleri** ve **Shader paketleri** sayfalarını açıp Minecraft 26.3 ile uyumlu içerikleri arayabilirsin. En yeni uyumlu Modrinth sürümü yayın tarihine göre seçilir, yalnızca güvenilir Modrinth CDN'sinden HTTPS ile indirilir ve SHA-1 özeti doğrulandıktan sonra sırasıyla `resourcepacks` veya `shaderpacks` klasörüne atomik olarak yerleştirilir. Modlar için Fabric ve Minecraft sürümü uyumluluğu korunur; dosyalar aynı şekilde SHA-1 ile doğrulanır. Modrinth ile kurulan içerikleri launcher'dan kaldırabilir, oyun klasörlerini açabilirsin.

## macOS derlemesi

macOS paket yapılandırması ve çıktı klasörü [macos-client/](./macos-client/) altında ayrı tutulur; Windows `.exe` çıktısı `release/`, macOS `.dmg` ve `.zip` çıktıları `macos-client/release/` içine yazılır. Uygulama kaynak kodu ortak tutulur, böylece özellikler iki platformda da aynı kalır ve ayrı kopyalar zamanla farklılaşmaz. macOS üzerinde Node.js 22.12+ ve JDK 25+ ile:

```sh
npm install
npm run package:macos
```

macOS'un varsayılan Minecraft klasörü `~/Library/Application Support/minecraft` olur. macOS paketini imzalama ve notarization için Apple Developer sertifikası/kimlik bilgileri gerekir; bu aygıttan imza kimlik bilgileri eklenmez.

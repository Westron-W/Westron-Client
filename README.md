# Westron Launcher

Windows ve macOS için açık/koyu temalı Minecraft launcher. 1.8–26.3 arası oyun sürümlerini, en yeni snapshot'ı ve Vanilla, Fabric veya Forge profillerini destekler.

## Geliştirme

- Node.js 22.12 veya üzeri
- JDK 25 veya üzeri (oyun içi Fabric modunu derlemek için)

Fabric kurulumundan sonra oyunu Microsoft hesabınla veya ayrı bir çevrimdışı kullanıcı adıyla başlatabilirsin. Minecraft Java profili ve oyun erişimi doğrulanmadan çevrimiçi oturum başlatılmaz. Çevrimdışı oturum tek oyunculu ve offline-mode sunucular içindir. Minecraft 26.3, Fabric, gerekli oyun dosyaları ve Java çalışma zamanı ilk kurulum/başlatma sırasında otomatik hazırlanır.

## Özellikler

- Her Minecraft sürümü ve loader için ayrı oyun profili/klasörü oluşturur; ilk kullanımda klasör konumunu bildirir.
- Fabric, Forge veya Vanilla profillerini seçili Minecraft sürümüne göre kurar; önceden indirilmiş oyun dosyası şartı yoktur.
- Oyun içi duraklatma ekranını değiştiren Westron Launcher Fabric modunu ve Fabric API'yi birlikte kurar.
- Microsoft → Xbox Live → XSTS → Minecraft kimlik doğrulamasını ve Java profili/oyun sahipliği kontrolünü uygular; yenileme bilgilerini Windows güvenli depolamasında tutar.
- Microsoft hesabından bağımsız Westron hesabıyla skin ve pelerin yüklemeyi destekler. Görünümler, Westron Fabric istemci modunu kullanan diğer oyunculara da aktarılır; modsuz istemciler özel görünümleri alamaz.
- Skin & Pelerin ekranında skin ve pelerini dokulu hareketli 3D karakter üzerinde önizler; animasyon, dönüş ve hız ayarları sunar.
- Seçili Minecraft sürümü ve Fabric/Forge loader ile uyumlu modları Modrinth'te arar; yüklemeden önce uyumlu yayın sürümünü seçtirir ve zorunlu bağımlılıkları onayla birlikte kurar.
- Performans Modları'nda mod kurmayan varsayılan profili, uyumlu performans modlarını içeren Ultra Performans profilini ve uzak mesafe/görsel modları içeren Ultra Kalite profilini sunar. İki özel tema isteğe bağlıdır; Complementary shader kurulumu Fabric ve Iris ister, varsayılan olarak kapalıdır ve oyun içindeki Shader Packs menüsünden ayrıca etkinleştirilir.
- Kaynak paketlerini ve shader paketlerini seçili Minecraft sürümüne uygun yayınlarla kurar; SHA-1 doğrulaması yapar.
- Mod, kaynak paketi ve shader aramalarında sonuçları 18'er öğelik sayfalarla gösterir; kütüphanedeki yüklü içeriklerin proje görsellerini, kaldırma ve klasörü açma kontrollerini sunar.
- Oyun ekran görüntülerini sayfalar halinde yükler, görüntüleyicide önceki/sonraki ekran görüntülerine geçişi, onaylı silmeyi ve ekran görüntüsü klasörünü açmayı destekler.
- İlk açılışta ve Ayarlar'da Türkçe, İngilizce, Almanca, Fransızca, İspanyolca, Rusça ve İtalyanca dil seçenekleri sunar.
- Açık/koyu temaları ve ekran boyutuna uyumlu pencere düzenini destekler; Westron hesabında parola sıfırlama akışıyla parola değiştirmeyi sağlar.
- Launcher'ın oyun sırasında ve oyun kapandıktan sonraki davranışını ayarlamayı; yalnızca doğrulanmış `ermiscaner78@gmail.com` hesabıyla Windows güncelleme dosyalarını yayımlamayı destekler.
- Yüklü JAR modlarını listeler, kaldırır ve oyun klasörünü açar.
- Sunucu adresini doğrulayıp panoya kopyalar; oyun içinde çok oyunculu menüsünden bağlanılır.

Fabric kurulumu tamamlanınca Westron Launcher modu da `mods` klasörüne eklenir. Oyun içindeki ESC tuşu koyu özel menüyü açar; mod menüsünden mevcut Fabric mod sayısını görebilir ve oyun ayarlarına geçebilirsin.

## Westron Skin API

Microsoft/Minecraft Launcher kimlik doğrulamasından bağımsız skin servisi backend'i [`skin-api/`](./skin-api/) dizinindedir. Kurulum, Docker/Nginx Proxy Manager ayarları, API endpoint'leri ve test komutları için [skin-api/README.md](./skin-api/README.md) dosyasına bakın. Fabric istemci modülü Westron skin ve pelerinlerini ve mevcut herkese açık Minecraft görünümlerini istemci tarafında yükler; PNG'leri HTTPS üzerinden alıp yerel önbelleğe alır. Başka launcher kullanan oyuncular `npm run build:mod` komutuyla oluşturulan `fabric-mod/build/libs/westron-client-skin-1.0.3.jar` dosyasını uyumlu Fabric profilinin `mods` klasörüne ekleyebilir. Modsuz istemciler özel görünümleri göremez; Westron profilinin otomatik bulunması için oyun adı Westron kullanıcı adıyla aynı olmalıdır.

## Sürüm numaraları

Uygulama, Fabric modülü ve Windows/macOS paketlerinin sürümü `1.0.3`'tür. Windows kurulum dosyasının adı `Westron-Launcher-Setup-1.0.3.exe`'dir. Windows güncellemeleri GitHub Releases üzerinden denetlenir.

## Modrinth paketleri

Sol menüden **Kaynak paketleri**, **Shader paketleri** ve **Mod Paketleri** sayfalarını açıp Minecraft 26.3 ile uyumlu içerikleri arayabilirsin.

Yeni sürüm, `v<version>` etiketi GitHub'a gönderildiğinde Actions tarafından derlenip GitHub Release olarak yayımlanır. İndirme bölümünde yalnızca Windows `.exe` ve macOS `.dmg` görünür. Windows güncelleme manifesti GitHub'daki ayrı bir feed branch'inde tutulur; `.blockmap` dosyası GitHub Release'e yüklenmez. Ayrıntılar için [güncelleme yayımlama kılavuzuna](./docs/updates-deployment.md) bakın.

## İndirmeler

- [Windows kurulum dosyası](https://github.com/Westron-W/Westron-Client/releases/latest)
- [macOS kurulum dosyası](https://github.com/Westron-W/Westron-Client/releases/latest)

## Westron Launcher genel bakış

<img width="1755" height="1077" alt="Westron Launcher ekran görüntüsü" src="https://github.com/user-attachments/assets/732f0d3a-cbaf-4411-9129-7d6b01fdf318" />

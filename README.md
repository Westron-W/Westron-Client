# Westron Client

Windows ve macOS için koyu temalı Minecraft launcher. 1.8–26.3 arası oyun sürümlerini, en yeni snapshot'ı ve Vanilla, Fabric veya Forge profillerini destekler.

## Geliştirme

- Node.js 22.12 veya üzeri
- JDK 25 veya üzeri (oyun içi Fabric modunu derlemek için)

Fabric kurulumundan sonra oyunu Microsoft hesabınla veya ayrı bir çevrimdışı kullanıcı adıyla başlatabilirsin. Minecraft Java profili ve oyun erişimi doğrulanmadan çevrimiçi oturum başlatılmaz. Çevrimdışı oturum tek oyunculu ve offline-mode sunucular içindir. Minecraft 26.3, Fabric, gerekli oyun dosyaları ve Java çalışma zamanı ilk kurulum/başlatma sırasında otomatik hazırlanır.

## Özellikler

- Her Minecraft sürümü ve loader için ayrı oyun profili/klasörü oluşturur; ilk kullanımda klasör konumunu bildirir.
- Fabric, Forge veya Vanilla profillerini seçili Minecraft sürümüne göre kurar; önceden indirilmiş oyun dosyası şartı yoktur.
- İndirme kaynakları geçici olarak erişilemediğinde ASM analiz kütüphanesi için doğrulanmış Maven Central yedeğini kullanır; dosyayı SHA-1 ve boyutla doğrular.
- Oyun içi duraklatma ekranını değiştiren Westron Client Fabric modunu ve Fabric API'yi birlikte kurar.
- Microsoft → Xbox Live → XSTS → Minecraft kimlik doğrulamasını ve Java profili/oyun sahipliği kontrolünü uygular; yenileme bilgilerini Windows güvenli depolamasında tutar.
- Microsoft hesabından bağımsız Westron hesabıyla skin ve pelerin yüklemeyi destekler. Görünümler, Westron Fabric istemci modunu kullanan diğer oyunculara da aktarılır; modsuz istemciler özel görünümleri alamaz.
- Skin & Pelerin ekranında skin ve pelerini dokulu hareketli 3D karakter üzerinde önizler; animasyon, dönüş ve hız ayarları sunar.
- Seçili Minecraft sürümü ve Fabric/Forge loader ile uyumlu modları Modrinth'te arar; yüklemeden önce uyumlu yayın sürümünü seçtirir ve zorunlu bağımlılıkları onayla birlikte kurar.
- Kaynak paketlerini ve shader paketlerini seçili Minecraft sürümüne uygun yayınlarla kurar; SHA-1 doğrulaması yapar.
- İlk açılışta, Ayarlar'da ve Windows kurulum sihirbazında Türkçe, İngilizce, Almanca, Fransızca, İspanyolca, Rusça ve İtalyanca dil seçenekleri sunar. Diğer launcher ekranlarının tamamı henüz bu dillere çevrilmemiştir.
- Yüklü JAR modlarını listeler, kaldırır ve oyun klasörünü açar.
- Sunucu adresini doğrulayıp panoya kopyalar; oyun içinde çok oyunculu menüsünden bağlanılır.

Fabric kurulumu tamamlanınca Westron Client modu da `mods` klasörüne eklenir. Oyun içindeki ESC tuşu koyu özel menüyü açar; mod menüsünden mevcut Fabric mod sayısını görebilir ve oyun ayarlarına geçebilirsin.

## Westron Skin API

Microsoft/Minecraft Launcher kimlik doğrulamasından bağımsız skin servisi backend'i [`skin-api/`](./skin-api/) dizinindedir. Kurulum, Docker/Nginx Proxy Manager ayarları, API endpoint'leri ve test komutları için [skin-api/README.md](./skin-api/README.md) dosyasına bakın. Fabric istemci modülü Westron skin ve pelerinlerini ve mevcut herkese açık Minecraft görünümlerini istemci tarafında yükler; PNG'leri HTTPS üzerinden alıp yerel önbelleğe alır. Başka launcher kullanan oyuncular `npm run build:mod` komutuyla oluşturulan `fabric-mod/build/libs/westron-client-skin-1.0.2.jar` dosyasını uyumlu Fabric profilinin `mods` klasörüne ekleyebilir. Modsuz istemciler özel görünümleri göremez; Westron profilinin otomatik bulunması için oyun adı Westron kullanıcı adıyla aynı olmalıdır.

## Sürüm numaraları

Uygulama, paket, Windows kurulum dosyası ve Fabric skin modunun sürümü `1.0.2`'dir. Kurulum dosyası `release/Westron-Client-Setup-1.0.2.exe` adını alır. Windows güncelleme denetimi GitHub Releases üzerinden yapılır.

Yeni sürüm, `v<version>` etiketi GitHub'a gönderildiğinde Actions tarafından derlenip GitHub Release olarak yayımlanır. Windows `.exe`, `.exe.blockmap` ve `latest.yml` dosyalarının tümü release'e eklenir; updater bu metadata'yı kullanır. `1.0.1` sürümünde kullanılan eski update adresi artık erişilebilir olmadığından, bu sürümde kalan kullanıcıların `1.0.2` kurulumunu GitHub Releases sayfasından bir kez elle yüklemesi gerekir. Sonraki sürümler otomatik güncellenir.

## Modrinth paketleri

Sol menüden **Kaynak paketleri** , **Shader paketleri** ve **Mod Paketleri** sayfalarını açıp Minecraft 26.3 ile uyumlu içerikleri arayabilirsin.

## macOS derlemesi

MacOs Sorunsuz Şekilde Çalışır Uygun .dmg Dosyasını İndirip Kullanmaya Başlayabilirsiniz

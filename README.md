Windows ve macOS için koyu temalı Minecraft launcher. 1.8–26.3 arası oyun sürümlerini, en yeni snapshot'ı ve Vanilla, Fabric veya Forge profillerini destekler.

## Geliştirme

- Node.js 22.12 veya üzeri
- JDK 25 veya üzeri (oyun içi Fabric modunu derlemek için)

Fabric kurulumundan sonra oyunu Microsoft hesabınla veya ayrı bir çevrimdışı kullanıcı adıyla başlatabilirsin. Minecraft Java profili ve oyun erişimi doğrulanmadan çevrimiçi oturum başlatılmaz. Çevrimdışı oturum tek oyunculu ve offline-mode sunucular içindir. Minecraft 26.3, Fabric, gerekli oyun dosyaları ve Java çalışma zamanı ilk kurulum/başlatma sırasında otomatik hazırlanır.

## Özellikler

- Her Minecraft sürümü ve loader için ayrı oyun profili/klasörü oluşturur; ilk kullanımda klasör konumunu bildirir.
- Fabric, Forge veya Vanilla profillerini seçili Minecraft sürümüne göre kurar; önceden indirilmiş oyun dosyası şartı yoktur.
- Oyun içi duraklatma ekranını değiştiren Westron Client Fabric modunu ve Fabric API'yi birlikte kurar.
- Microsoft → Xbox Live → XSTS → Minecraft kimlik doğrulamasını ve Java profili/oyun sahipliği kontrolünü uygular; yenileme bilgilerini Windows güvenli depolamasında tutar.
- Microsoft hesabından bağımsız Westron hesabıyla skin ve pelerin yüklemeyi destekler. Görünümler, Westron Fabric istemci modunu kullanan diğer oyunculara da aktarılır; modsuz istemciler özel görünümleri alamaz.
- Skin & Pelerin ekranında skin ve pelerini dokulu hareketli 3D karakter üzerinde önizler; animasyon, dönüş ve hız ayarları sunar.
- Seçili Minecraft sürümü ve Fabric/Forge loader ile uyumlu modları Modrinth'te arar; yüklemeden önce uyumlu yayın sürümünü seçtirir ve zorunlu bağımlılıkları onayla birlikte kurar.
- Yüklü JAR modlarını listeler, kaldırır ve oyun klasörünü açar.

Fabric kurulumu tamamlanınca Westron Client modu da `mods` klasörüne eklenir. Oyun içindeki ESC tuşu koyu özel menüyü açar; mod menüsünden mevcut Fabric mod sayısını görebilir ve oyun ayarlarına geçebilirsin.

## Westron Skin API

Microsoft/Minecraft Launcher kimlik doğrulamasından bağımsız skin servisi kendi "Westron Skin API"'sidir.Ve Westron Client'e Özel Bir Pakettir.

## Sürüm numaraları

Uygulama, Fabric modülü ve Windows/macOS paketlerinin sürümü `1.0.1`'dir. Windows kurulum dosyası `release/Westron-Client-Setup-1.0.1.exe` adını alır. Windows güncelleme denetimi GitHub Releases üzerinden yapılır.

## Modrinth paketleri

Sol menüden **Kaynak paketleri** , **Shader paketleri** ve **Mod Paketleri** sayfalarını açıp Minecraft 26.3 ile uyumlu içerikleri arayabilirsin.

## Windows derlemesi

Windows Sorunsuz Şekilde Çalışır Uygun .exe Dosyasını İndirip Kullanmaya Başlayabilirsiniz

## macOS derlemesi

MacOs Sorunsuz Şekilde Çalışır Uygun .dmg Dosyasını İndirip Kullanmaya Başlayabilirsiniz

## Westron Client genel bakış:
<img width="1755" height="1077" alt="image" src="https://github.com/user-attachments/assets/732f0d3a-cbaf-4411-9129-7d6b01fdf318" />


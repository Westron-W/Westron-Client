# Westron Client

Windows Ve MacOs İçin, Fabric ve Minecraft 26.3 odaklı masaüstü launcher.

## Geliştirme

- Node.js 22.12 veya üzeri
- JDK 25 veya üzeri (oyun içi Fabric modunu derlemek için)

Fabric kurulumundan sonra oyunu Microsoft hesabınla veya ayrı bir çevrimdışı kullanıcı adıyla başlatabilirsin. Minecraft Java profili ve oyun erişimi doğrulanmadan çevrimiçi oturum başlatılmaz. Çevrimdışı oturum tek oyunculu ve offline-mode sunucular içindir. Minecraft 26.3, Fabric, gerekli oyun dosyaları ve Java çalışma zamanı ilk kurulum/başlatma sırasında otomatik hazırlanır.

## Özellikler

- Fabric Loader'ı Fabric Meta API'sinden indirip Minecraft 26.3 oyun dizinine kurar; önceden indirilmiş bir oyun sürümü şartı yoktur.
- Oyun içi duraklatma ekranını değiştiren Westron Client Fabric modunu ve Fabric API'yi birlikte kurar.
- Microsoft → Xbox Live → XSTS → Minecraft kimlik doğrulamasını ve Java profili/oyun sahipliği kontrolünü uygular; yenileme bilgilerini Windows güvenli depolamasında tutar.
- Microsoft hesabından bağımsız Westron hesabıyla skin yüklemeyi destekler.
- Fabric ve Minecraft 26.3 uyumlu modları Modrinth'te arar; zorunlu bağımlılıkları indirmeden önce listeler ve onaydan sonra birlikte kurar.
- Mod menüsünden ayrı olarak Modrinth kaynak paketi ve shader paketlerini en yeni Minecraft 26.3 uyumlu sürümleriyle kurar, hash doğrular ve eski Westron-yönetimli sürümü günceller. Shader çalıştırmak için Iris 26.3 Fabric altyapısını kurma   olanağı sağlar.
- Yüklü JAR modlarını listeler, kaldırır ve oyun klasörünü açar.
- Sunucu adresini doğrulayıp panoya kopyalar; oyun içinde çok oyunculu menüsünden bağlanılır.

Fabric kurulumu tamamlanınca Westron Client modu da `mods` klasörüne eklenir. Oyun içindeki ESC tuşu koyu özel menüyü açar; mod menüsünden mevcut Fabric mod sayısını görebilir ve oyun ayarlarına geçebilirsin.

## Westron Skin API

Westron Skin API Westron Client in Kendi Varsayılan Skin Dosyasıdır.Başka Launcherlar Veya Premium Minecraft İçin Uyumludur.

## Sürüm numaraları

Sürüm Şuan Da Yeni Yayımlanan 1.0.0 dır. Yeni Sürümler Yakında Geliyor...


## Modrinth paketleri

Sol menüden **Kaynak paketleri** , **Shader paketleri** ve **Mod Paketleri** sayfalarını açıp Minecraft 26.3 ile uyumlu içerikleri arayabilirsin.

## macOS derlemesi

MacOs Sorunsuz Şekilde Çalışır Uygun .dmg Dosyasını İndirip Kullanmaya Başlayabilirsiniz

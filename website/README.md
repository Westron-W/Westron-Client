# Westron Launcher

Westron Launcher web arayüzü; Windows ve macOS indirme sayfası, Westron hesabıyla giriş ve e-posta doğrulama, hesap özeti, 3D karakter önizlemesi ile PNG skin ve pelerin yükleme/değiştirme/kaldırma işlemlerini destekler. Hesap, Microsoft/Minecraft hesabından ayrıdır. Görseller Westron skin API tarafından doğrulanır ve saklanır. Oturum aynı tarayıcıda sayfa yenilense veya tarayıcı yeniden açılsa da korunur ve en geç 30 günde sona erer; çıkış yapmak oturumu hemen kapatır ancak hesabı silmez.

## Çalıştırma

Node.js 20 veya üzeri gerekir. Görüntüleyici paketi yerel olarak sunulur; ek npm kurulumu gerekmez:

```powershell
node .\server.mjs
```

Site `http://localhost:4173` adresinde açılır. API varsayılan olarak `https://westronskin.sytes.net` adresine sınırlı bir sunucu proxy'si üzerinden bağlanır. Farklı bir API adresi için `WESTRON_API_ORIGIN` ortam değişkenini kullanın.

## Dağıtım

Node.js destekleyen bir sunucuda `server.mjs`, `index.html`, `styles.css`, `app.js`, `favicon.svg` ve `skinview3d.bundle.js` dosyalarını birlikte dağıtın. `skinview3d.LICENSE`, `skinview-utils.LICENSE` ve `three.LICENSE` lisans bildirimlerini de dağıtımda bulundurun. Platformun `PORT` değişkeni desteklenir. HTTPS üzerinden yayınlayın; API istekleri aynı origin'deki `/_api` uç noktası üzerinden iletilir. Proxy, yalnızca hesap/skin uç noktalarını sabit Westron Skin API origin'ine aktarır ve isteklere ait gövdeyi bellekte tutar; istek veya hesap bilgisi kaydetmez.

3D karakter önizlemesi skin/pelerin doku eşlemesi, animasyon ve döndürme için skinview3d 3.4.2 kullanır (MIT lisansları; `skinview3d.LICENSE`, `skinview-utils.LICENSE`, `three.LICENSE`).

Skin PNG dosyaları 1 MiB ile sınırlıdır ve 64×64 ya da 64×32 piksel olmalıdır. Pelerinler PNG biçiminde, 1 MiB altı ve API'nin kabul ettiği ölçülerde olmalıdır. Bu görünümler Westron skin modunu kullanan oyuncularda görünür; modsuz Minecraft istemcileri özel skinleri gösteremez.

# Formül11 — Proje Notları

Bu klasör, statik bir tanıtım sitesi + basit bir içerik yönetim paneliyle başlamış bir futbol istatistik/analiz projesinin başlangıç kitidir. Claude Code'a (ya da başka bir geliştirme ortamına) taşınmak üzere hazırlandı.

## 1. İsim geçmişi (neden Formül11?)

Proje sırasıyla üç isim denedi:

1. **Maç Beyni** — ilk taslak, kimseyle çakışma kontrol edilmedi, kenarda duruyor.
2. **Skor Kahini** — `skorkahini.com` adresinde, aynı isim ve aynı konseptte (arkadaşlarla maç tahmin yarışması), aktif kullanıcı tabanı olan gerçek bir rakip bulununca elendi.
3. **Formül11** — arama + domain + sosyal medya kontrolünden geçti, aynı isim/konseptte canlı bir rakip bulunamadı. **Karar bu.**

## 2. Sosyal medya / domain durumu (27 Temmuz 2026 itibarıyla)

| Platform | formul11 | Not |
|---|---|---|
| Telegram | Dolu | @formul11 = alakasız "Formula 1" botu/kanalı. Varyant gerekli. |
| Instagram | Dolu | Küçük/pasif hesap ("formol wan", 13 takipçi). Gerçek risk yok ama varyant önerilir. |
| X (Twitter) | Dolu | 2011'den kalma pasif hesap, alakasız. Varyant önerilir. |
| YouTube | **Müsait görünüyor** | @formul11 boş. |
| Kick | **Müsait görünüyor** | formul11 kanalı yok. |
| Domain formul11.com | **Müsait görünüyor** | Canlı içerik bulunamadı, ama resmi whois teyidi yapılmadı — kayıt öncesi bir registrar'dan (Namecheap, Godaddy, Turhost vb.) doğrula. |

**Öneri:** Instagram / X / Telegram için `resmiformul11` gibi bir varyant kullanıcı adı kullan; YouTube ve Kick'te düz `formul11` alınabilir.

Not: Bu kontroller otomatik sayfa taramasıyla yapıldı, resmi bir marka/patent araması değildir. Şirket kurmadan ve ciddi bütçe harcamadan önce bir marka vekiliyle Türk Patent ve Marka Kurumu (TÜRKPATENT) üzerinden marka tescili taraması yaptırmanı öneririm — özellikle uygulamayı büyütmeyi düşünüyorsan.

## 3. Yasal / hukuki notlar (ayrıntı değil, hatırlatma)

- Bu bir **istatistik/analiz platformu** olarak konumlandırıldı, bahis operatörü değil. Bahis sitelerine yönlendirme, affiliate link veya "kupon/banko" gibi bahis çağrışımlı kelimeler bilerek kullanılmadı — Türkiye'de yasadışı bahis reklamı ciddi bir suç (7258 sayılı Kanun). Bunu korumaya devam et.
- Hiçbir sayfada "%X garanti başarı oranı" gibi doğrulanamayan iddialar yok. Gerçek performans verisi biriktikçe şeffaf şekilde eklenebilir; uydurma sayı yazma (bkz. golsinyali.com incelemesinde bulduğumuz "yanlış şirket numarası" hatası — güveni tamamen çökertebilecek türden bir hata).
- 18+ yaş sınırı ve "sorumlu kullanım" mesajı tüm sayfalarda mevcut.
- Şirket resmen kurulmadan Hakkımızda / footer'a sahte şirket numarası, adres yazılmadı — bilerek boş bırakıldı (`hakkimizda.html` içinde ilgili not var).
- KVKK/GDPR uyumu iddiası var (`sss.html`) — gerçek veri işleme başladığında bir gizlilik politikası metniyle desteklenmeli (bu kitte yok, eklenmesi lazım).

## 4. Dosya yapısı

```
Formul11/
├── index.html          → Ana sayfa (hero, analizler, özellikler, fiyatlandırma)
├── sss.html             → SSS sayfası (FAQPage schema.org verisiyle, SEO için)
├── hakkimizda.html      → Hakkımızda sayfası
├── config.js            → Sosyal medya linkleri + fiyatlandırma verisi (site buradan okur)
├── panel.html           → config.js'i formla düzenleyip indirmeni sağlayan basit panel
├── Formul11-Ortaklik-Sunumu.pptx  → İş birliği / affiliate görüşmeleri için tanıtım sunumu
├── Formul11-Proje-Ozeti.pdf       → Bu notların PDF hâli
└── PROJE-NOTLARI.md     → (bu dosya)
```

Not: Bu sitenin **backend'i, veritabanı, kullanıcı girişi, ödeme entegrasyonu veya gerçek AI tahmin motoru yok.** Şu ana kadar yapılan her şey statik HTML/CSS/JS — yani bir "tasarım + iskelet" aşaması. `panel.html` da gerçek bir CMS değil, config.js dosyasını üretip indirmeni sağlayan basit bir form; her değişiklikte dosyayı elle değiştirmen gerekiyor.

## 5. Claude Code'da sırada ne var?

Öncelik sırasıyla önerilen adımlar:

1. **Gerçek veri kaynağı** — maç, oran, istatistik verisini nereden çekeceğin (ücretsiz/ücretli bir sports-data API: API-Football, SportMonks, Football-Data.org gibi seçenekler var, fiyat/limit karşılaştırması gerekir).
2. **Basit bir backend** — kullanıcı kaydı, premium üyelik durumu, ödeme (Stripe önerilir, KVKK uyumlu ödeme akışı) için.
3. **Gerçek AI/istatistik modeli** — şu an sitedeki %74 / %81 gibi güven skorları örnektir, gerçek bir hesaplama motoruna bağlanmalı.
4. **Domain + hosting** — formul11.com alınır alınmaz Vercel/Netlify/Cloudflare Pages gibi ücretsiz bir statik hosting'e bu klasör deploy edilebilir (şu haliyle hiç kod değişikliği gerekmez).
5. **panel.html'i gerçek bir admin paneline dönüştürmek** — bir veritabanı/backend geldiğinde, config.js yerine gerçek bir ayarlar API'si kullanılabilir.
6. **Gizlilik Politikası ve Kullanım Koşulları** sayfalarının yazılması (şu an sadece footer'da link olarak duruyor, içerik yok).

## 6. Bütçe notu

- Statik hosting (Vercel/Netlify/Cloudflare Pages): ücretsiz
- Domain (.com): ~150-300₺/yıl
- Sports-data API: ücretsiz katmanlar genelde sınırlı istek/gün; ciddi kullanım için aylık $10-50 aralığında planlar yaygın (sağlayıcıya göre değişir, teyit et)
- UK Ltd (ileride istenirse): formation agent üzerinden ~100-200£ kuruluş + yıllık confirmation statement/muhasebe maliyeti

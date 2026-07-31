# Formül11 — Proje Bağlamı

## Proje nedir

Formül11 — yapay zeka/istatistik destekli futbol maç analizi platformu. Bahis operatörü DEĞİL; bahis oynatmaz, affiliate/yönlendirme yapmaz. Amaç: takım formu ve gol istatistiklerinden şeffaf, açıklanabilir bir olasılık modeli üretmek.

İsim geçmişi, hukuki notlar, dosya yapısı gibi başlangıç bağlamı için `PROJE-NOTLARI.md` dosyasına bak — bu dosya (CLAUDE.md) ondan sonraki gerçek mimari kurulumu anlatıyor.

## Mevcut durum (31 Temmuz 2026 itibarıyla)

Statik HTML sitesi artık gerçek bir Firebase backend'ine ve otomatik veri hattına bağlı. Sırasıyla şunlar kuruldu:

1. **Firebase projesi `formul11`** — Firestore (eur3 bölgesi) etkin, güvenlik kuralları deploy edildi.
2. **Poisson tabanlı tahmin motoru** (`scripts/predict.js`) — football-data.org'un ücretsiz planına dahil 10 ligin puan durumundan takım hücum/savunma katsayıları çıkarıp yaklaşan maçlar için 1-X-2 olasılığı hesaplıyor. Gerçek bir "AI modeli" değil, şeffaf ve açıklanabilir istatistiksel bir yöntem — sitenin "şeffaf metodoloji" vaadiyle tutarlı, uydurma değil.
3. **GitHub Actions cron** (`.github/workflows/update-predictions.yml`) — her gün 05:00 UTC'de `predict.js`'i çalıştırıp sonucu Firestore'a yazıyor. Firebase Cloud Functions kullanılmadı çünkü onlar Blaze (ücretli) plan gerektiriyor; GitHub Actions'ın ücretsiz kotası (public repo'da sınırsız, private'ta 2000dk/ay) bu iş için yeterli ve kalıcı olarak ücretsiz.
4. **index.html** artık `firebase-app.js` üzerinden Firestore'dan canlı veri okuyor (öne çıkan analizler tablosu + takip edilen maç sayısı istatistiği). Eskiden hardcoded olan "180+ Lig / 60K+ Analiz" gibi doğrulanamaz iddialar kaldırıldı, gerçek kapsamla ("10 Büyük Lig") değiştirildi.
5. **Gizlilik Politikası (`gizlilik.html`) ve Kullanım Koşulları (`kosullar.html`)** yazıldı — şirket resmen kurulmadığı için hakkimizda.html'deki aynı dürüstlük ilkesiyle ("kuruluş süreci devam ediyor", uydurma şirket bilgisi yok) hazırlandı.
6. **Premium/Yıllık butonları** gerçek ödeme almıyor — "Yakında, haber ver" bekleme listesi (e-posta, Firestore `premium_interest` koleksiyonu). Stripe entegrasyonu, kullanıcı gerçek kimlik/IBAN bilgisiyle bir Stripe hesabı açtığında yapılacak.
7. **GitHub:** `depofiti-design/formul11-site` (private repo).
8. **Vercel:** proje adı `formul11`, takım `depofiti-1840s-projects`, GitHub reposuna bağlı, her push otomatik deploy tetikliyor. Canlı URL: **https://formul11.vercel.app** (SSO koruması kapalı, herkese açık — Gezicorn'da yaşanan sorun burada baştan kontrol edildi).

## Firebase config (aktif proje)

```js
const firebaseConfig = {
  apiKey: "AIzaSyDpQX1fBXrQZEtL8Vvvu8chba7OooWFXxs",
  authDomain: "formul11.firebaseapp.com",
  projectId: "formul11",
  storageBucket: "formul11.firebasestorage.app",
  messagingSenderId: "809645418846",
  appId: "1:809645418846:web:136be1ef0ab6cbb65987cf"
};
```
`firebase-app.js` içinde tanımlı, `index.html` bunu module script olarak yüklüyor.

## Firestore koleksiyonları ve kurallar

- `matches` — public read, client write yasak (`firestore.rules`). Sadece Admin SDK (GitHub Actions üzerinden `serviceAccountKey.json` / `FIREBASE_SERVICE_ACCOUNT_JSON` secret'ı ile) yazabiliyor. Alanlar: `competition_code`, `competition_name`, `home_team`, `away_team`, `match_date`, `home_win_prob`, `draw_prob`, `away_win_prob`, `confidence`, `model`, `updated_at`.
- `premium_interest` — public create-only (e-posta bırakma), read/update/delete client'tan kapalı (toplu e-posta sızıntısını önlemek için). Alanlar: `email`, `plan`, `created_at`.

## ⚠️ Kalan tek manuel adım: football-data.org API anahtarı

Tahmin pipeline'ı **henüz canlı veri çekmiyor** çünkü `FOOTBALL_DATA_API_KEY` GitHub secret'ı eksik. Bu, Claude Code'un yapamadığı tek adım — football-data.org'da e-posta ile hesap açmak e-posta onay tıklaması gerektiriyor ve bu ortamda gerçek bir tarayıcı kontrolü yok.

**Yapılması gereken (2 dakika, ücretsiz, kart bilgisi istemiyor):**
1. https://www.football-data.org/client/register adresinden ücretsiz kaydol.
2. E-postana gelen onay linkine tıkla.
3. Hesap panelinden API key'i kopyala.
4. Terminalde: `gh secret set FOOTBALL_DATA_API_KEY --repo depofiti-design/formul11-site` komutunu çalıştırıp key'i yapıştır — ya da Claude Code'a key'i ver, o ekler.

Bu secret eklenince workflow'u elle tetiklemek için: `gh workflow run update-predictions.yml --repo depofiti-design/formul11-site` — ya da bir sonraki gün 05:00 UTC'de otomatik çalışır.

## Diğer bilinçli olarak ertelenen adımlar

- **Domain (formul11.com)** — gerçek bir ödeme işlemi olduğu için Claude Code satın alamaz. Kullanıcı uygun zamanda alıp Vercel'e bağlayacak; kod tarafında hiçbir değişiklik gerekmiyor.
- **Stripe / gerçek ödeme tahsilatı** — kimlik/IBAN gerektirdiği için iskelet (bekleme listesi) olarak bırakıldı. Kullanıcı hesap açtığında entegre edilecek.
- **"180+ lig" tarzı pazarlama abartıları** düzeltildi ama premium'a geçildiğinde/API planı yükseltildiğinde kapsam gerçekten genişlerse metinler tekrar güncellenmeli.

## Yerel geliştirme notları

- `npm install` sonrası `node scripts/predict.js` lokalde çalıştırılabilir; `FOOTBALL_DATA_API_KEY` env değişkeni ve repo kökünde (gitignore'lu) `serviceAccountKey.json` gerekiyor. Bu dosya diskte mevcut, tekrar üretmek gerekirse Firebase IAM API'siyle yeni bir key oluşturulabilir (`firebase-adminsdk-fbsvc@formul11.iam.gserviceaccount.com` servis hesabı için).
- `panel.html` hâlâ eski/config.js indiren basit form — backend geldiği için artık asıl veri kaynağı değil, sosyal medya linkleri ve fiyat metni için düşük öncelikli bir araç olarak duruyor.

## Kullanıcı hakkında (ton/yaklaşım için)

Aynı kullanıcı (Barbaros) — Gezicorn ve BonusRota/Bonus Ufku projelerinde de aynı Vercel+Firebase+vanilla JS stack'ini kullanıyor. Bu oturumda "hepsini ücretsiz ve uzun vadede sorunsuz kur, onay isteme" talimatı verdi; proje dizini `.claude/settings.json`'a firebase/gh/vercel/git/npm/node/python3 için geniş bir izin listesi eklendi (bkz. `/Users/yakupbal/Desktop/aaaa/.claude/settings.json` — ana oturum dizini farklı bir proje/Gezicorn, izinler oradan yönetiliyor).
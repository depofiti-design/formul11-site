# Formül11 — Proje Bağlamı

## Proje nedir

Formül11 — yapay zeka/istatistik destekli futbol maç analizi platformu. Bahis operatörü DEĞİL; bahis oynatmaz, affiliate/yönlendirme yapmaz. Amaç: takım formu ve gol istatistiklerinden şeffaf, açıklanabilir bir olasılık modeli üretmek.

İsim geçmişi, hukuki notlar, dosya yapısı gibi başlangıç bağlamı için `PROJE-NOTLARI.md` dosyasına bak — bu dosya (CLAUDE.md) ondan sonraki gerçek mimari kurulumu anlatıyor.

## Mevcut durum (1 Ağustos 2026 itibarıyla)

Statik HTML sitesi artık gerçek bir Firebase backend'ine ve otomatik veri hattına bağlı, pipeline canlı veriyle test edildi. Sırasıyla şunlar kuruldu:

1. **Firebase projesi `formul11`** — Firestore (eur3 bölgesi) etkin, güvenlik kuralları deploy edildi ve test edildi (matches: public read/no write, premium_interest: public create-only).
2. **Poisson tabanlı tahmin motoru** (`scripts/predict.js`) — football-data.org'un ücretsiz planına dahil **9** ligin (Premier Lig, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Championship, Brasileirão) puan durumundan takım hücum/savunma katsayıları çıkarıp yaklaşan maçlar için 1-X-2 olasılığı hesaplıyor. Gerçek bir "AI modeli" değil, şeffaf ve açıklanabilir istatistiksel bir yöntem. **Önemli:** Türkiye Süper Lig (TR1) bu ücretsiz plana dahil DEĞİL — `/v4/competitions` ile teyit edildi, ilk denemede 404 verdi, script ve site metninden çıkarıldı. Sitede "Süper Lig" iddiası YOK, sadece gerçekten kapsanan ligler adı geçiyor.
3. **GitHub Actions cron** (`.github/workflows/update-predictions.yml`) — her gün 05:00 UTC'de `predict.js`'i çalıştırıp sonucu Firestore'a yazıyor. İlk manuel çalıştırmada **39 maç** başarıyla yazıldı. Firebase Cloud Functions kullanılmadı çünkü onlar Blaze (ücretli) plan gerektiriyor; GitHub Actions'ın ücretsiz kotası bu iş için kalıcı olarak yeterli.
4. **index.html** artık `firebase-app.js` üzerinden Firestore'dan canlı veri okuyor (öne çıkan analizler tablosu + takip edilen maç sayısı istatistiği). Eskiden hardcoded olan "180+ Lig / 60K+ Analiz" gibi doğrulanamaz iddialar kaldırıldı, gerçek kapsamla ("9 Büyük Lig") değiştirildi.
5. **Gizlilik Politikası (`gizlilik.html`) ve Kullanım Koşulları (`kosullar.html`)** yazıldı — şirket resmen kurulmadığı için hakkimizda.html'deki aynı dürüstlük ilkesiyle ("kuruluş süreci devam ediyor", uydurma şirket bilgisi yok) hazırlandı.
6. **Premium/Yıllık butonları** gerçek ödeme almıyor — "Yakında, haber ver" bekleme listesi (e-posta, Firestore `premium_interest` koleksiyonu). Stripe entegrasyonu, kullanıcı gerçek kimlik/IBAN bilgisiyle bir Stripe hesabı açtığında yapılacak.
7. **GitHub:** `depofiti-design/formul11-site` (private repo).
8. **Vercel:** proje adı `formul11`, takım `depofiti-1840s-projects`, GitHub reposuna bağlı, her push otomatik deploy tetikliyor. Canlı URL: **https://formul11.vercel.app** (SSO koruması kapalı, herkese açık).
9. **⚠️ Düzeltilen kritik hata (6 Ağustos 2026): 4 ligde sessizce hiç tahmin üretilmiyordu.** football-data.org'un `/standings` endpoint'i Serie A, Ligue 1, Eredivisie ve Championship'te zaten yeni (2026-27) sezona geçmişti — tüm takımlar 0 maç/0 gol olduğu için `buildTeamStrengths` hiçbir takım gücü çıkaramıyor, sonuç olarak yaklaşan her maç `if (!home || !away) continue` ile sessizce (hatasız, uyarısız) atlanıyordu. Kullanıcı "İtalya ligi neden yok" diye sorunca fark edildi. **Düzeltme:** standings'te oynanmış maç yoksa (`playedGames` hepsi 0) otomatik olarak bir önceki tamamlanmış sezona (`?season=YYYY-1`) düşülüyor — Süper Lig'de zaten var olan pattern'in aynısı. Düzeltmeden sonra 39 maçtan 68 maça çıktı, Serie A'da 7 gerçek maç yazıldı. **Not:** Süper Lig'in kendi ayrı sorunu var — TheSportsDB'nin ücretsiz test anahtarı hem güncel hem bir önceki sezonda sadece 5 takımı kapsıyor (bkz. aşağıdaki "kalan işler"), bu düzeltmeyle ilgisi yok, hâlâ çözülmedi. Ayrıca ana sayfadaki "Genel" sekmesi en yakın 6 maçı (tarihe göre) gösteriyor — Serie A'nın ilk maçı 22 Ağustos olduğu için diğer liglerin daha yakın tarihli maçları önde göründüğü sürece Serie A ana sayfa önizlemesinde hemen görünmeyebilir, ama veri artık doğru şekilde Firestore'da var.
10. **Geçmiş Analizler / İsabet Oranı sayfası (`gecmis-analizler.html`)** — sitenin zaten vaat ettiği ("Açık Performans Kaydı" kartı, index.html) geçmiş tahmin takibini gerçek veriyle dolduran sayfa. `scripts/evaluate-predictions.js` — `predict.js`'den hemen sonra aynı günlük cron'da çalışıyor (`npm run evaluate`) — tarihi geçmiş ama henüz `evaluated` alanı olmayan `matches` dokümanlarını bulup gerçek skoru (football-data.org `/matches/{id}` veya TheSportsDB `lookupevent.php`) çekiyor, tahmin edilen sonuçla (en yüksek olasılıklı 1-X-2) karşılaştırıp dokümana `actual_home_goals`, `actual_away_goals`, `actual_result`, `predicted_result`, `hit` (bool), `evaluated: true` alanlarını ekliyor. Sayfa bu alanları client-side (index-gerektirmeyen tek `orderBy`, sonra JS'te filtre — Gezicorn'daki `route_recommendations` pattern'iyle aynı mantık) okuyup: 3 istatistik kutusu (toplam tahmin, İsabet Oranı — SVG halka göstergeli, isabet sayısı + rastgele-%33 baseline'a göre delta), lig bazında isabet oranı bar grafiği (kesikli %33 referans çizgili) ve tıklayınca genişleyen tam geçmiş tahmin tablosu gösteriyor. **5 Ağustos 2026 itibarıyla Firestore'da 0 sonuçlanmış maç var** (site çok yeni, en erken maç 7 Ağustos) — sayfa bunun için düzgün bir boş durum gösteriyor ("gizlemiyoruz" mesajıyla), veri biriktikçe otomatik dolacak. Nav'a ve footer'a tüm sayfalardan link eklendi.

### ⚠️ Bilinen tuzak: git commit author'ı Vercel deploy'unu BLOCKED yapabilir

macOS'un varsayılan git identity'si (`YAKUP BAL <yakupbal@YAKUP-MacBook-Air.local>`) ile atılan commit'ler Vercel tarafından **"no git user associated with the commit"** hatasıyla `BLOCKED` duruma düşüyor (private repo + Vercel'in commit author'ı GitHub hesabıyla eşleştirememesi — bkz. [Vercel troubleshoot-project-collaboration](https://vercel.com/docs/deployments/troubleshoot-project-collaboration#account-configuration)). Bu hem `git push` sonrası otomatik deploy'da hem de `vercel --prod` CLI deploy'unda aynı şekilde oluyor (ikisi de commit metadata'sını okuyor).

**Kalıcı çözüm uygulandı:** global git config artık `depofiti-design <227688926+depofiti-design@users.noreply.github.com>` (GitHub'ın otomatik doğrulanmış noreply e-postası, `gh api user` ile alınan id+login'den türetildi). Bu ayar `~/.gitconfig` seviyesinde olduğu için tüm projelerde geçerli — Gezicorn/BonusRota'da da aynı sorun çıkmamalı. Eğer ileride yine `BLOCKED`/`readyState` sorunu görülürse: `git log -1 --format='%ae'` ile commit e-postasını kontrol et, global git config'in bozulup bozulmadığına bak.

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

## football-data.org API anahtarı — TAMAMLANDI

`FOOTBALL_DATA_API_KEY` GitHub secret'ı eklendi ve pipeline canlı veriyle test edildi (39 maç Firestore'a yazıldı, 9 gerçek lig üzerinden). Workflow'u elle tetiklemek için: `gh workflow run update-predictions.yml --repo depofiti-design/formul11-site`.

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
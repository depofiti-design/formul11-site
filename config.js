/*
  FORMÜL11 - SİTE AYARLARI
  ------------------------
  Bu dosya sitenin sosyal medya linklerini ve fiyatlandırmasını kontrol eder.
  Değişiklik yapmak için panel.html dosyasını aç, formu doldur, "config.js İndir"
  butonuna bas ve indirilen dosyayı bu dosyanın üzerine kaydet (aynı klasöre,
  aynı isimle). Sonra index.html / sss.html / hakkimizda.html sayfalarını
  yenilediğinde değişiklikler otomatik yansır.

  enabled: false olan bir platform ikonu sitede GÖSTERİLMEZ.
  enabled: true ve url dolu olan platform ikonu gösterilir ve tıklanınca oraya gider.
*/
window.SITE_CONFIG = {
  brand: {
    name: "Formül11",
    tagline: "Veriyle Oku, Sezgiyle Değil"
  },
  social: {
    instagram: { enabled: true, url: "https://instagram.com/formul11pro" },
    youtube:   { enabled: false, url: "" },
    tiktok:    { enabled: false, url: "" },
    x:         { enabled: true, url: "https://x.com/formul11pro" },
    telegram:  { enabled: true, url: "https://t.me/formul11pro" },
    kick:      { enabled: false, url: "" }
  },
  pricing: {
    currency: "₺",
    free: { price: "0", period: "/ay" },
    premium: { price: "49", period: "/ay" },
    yearly: { price: "399", period: "/yıl" }
  },
  stats: {
    leagues: "9",
    analyses: "Firestore'dan canlı"
  }
};

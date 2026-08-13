import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, query, where, orderBy, limit, getDocs, getCountFromServer, addDoc, Timestamp, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDpQX1fBXrQZEtL8Vvvu8chba7OooWFXxs",
  authDomain: "formul11.firebaseapp.com",
  projectId: "formul11",
  storageBucket: "formul11.firebasestorage.app",
  messagingSenderId: "809645418846",
  appId: "1:809645418846:web:136be1ef0ab6cbb65987cf"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function formatMatchDate(ts) {
  try {
    const d = ts.toDate();
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' · ' +
           d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

function renderMatches(el, matches, emptyMessage) {
  if (matches.length === 0) {
    el.innerHTML = '<div class="trow"><div>' + emptyMessage + '</div></div>';
    return;
  }
  el.innerHTML = '';
  matches.forEach(function (m) {
    const row = document.createElement('div');
    row.className = 'trow';
    const ouRow = (m.over_2_5_prob != null && m.under_2_5_prob != null)
      ? '<div class="trow-sublabel">Toplam gol (2.5 sınırı)</div>' +
        '<div class="prob-grid">' +
          '<div class="prob-item"><b>%' + m.over_2_5_prob + '</b><span>2.5 Üst</span></div>' +
          '<div class="prob-item"><b>%' + m.under_2_5_prob + '</b><span>2.5 Alt</span></div>' +
        '</div>'
      : '';
    row.innerHTML =
      '<div class="trow-head">' +
        '<div><div class="tag">' + m.competition_name + '</div>' + m.home_team + ' vs ' + m.away_team + '</div>' +
        '<span class="conf">%' + m.confidence + '</span>' +
      '</div>' +
      '<div class="trow-detail">' +
        '<div class="prob-grid">' +
          '<div class="prob-item"><b>%' + m.home_win_prob + '</b><span>' + m.home_team + '</span></div>' +
          '<div class="prob-item"><b>%' + m.draw_prob + '</b><span>Beraberlik</span></div>' +
          '<div class="prob-item"><b>%' + m.away_win_prob + '</b><span>' + m.away_team + '</span></div>' +
        '</div>' +
        ouRow +
        '<div class="trow-meta">' + formatMatchDate(m.match_date) + ' · İstatistiksel tahmindir, garanti değildir.</div>' +
      '</div>';
    row.addEventListener('click', function () { row.classList.toggle('open'); });
    el.appendChild(row);
  });
}

// "Genel" sekmesi her ligden en yakın maçı garanti eder — aksi halde takvimi
// geç başlayan ligler (ör. Serie A, sezonu 22 Ağustos'ta başlıyor) tarihe göre
// sıralamada hep en altta kalıp önizlemeden tamamen dışarıda kalabiliyordu.
// AMA gösterim sırası sabit lig adı değil, gerçek maç tarihi — yoksa (önceki
// haliyle) 9 gün sonraki bir Premier Lig maçı, 2-3 gün içindeki 5 farklı ligin
// maçının önüne geçip sayfayı "güncel değil" gösterebiliyordu. Her lig temsil
// ediliyor ama en yakın/en güncel maçlar hep başta.
async function loadGenel(el) {
  const matchesRef = collection(db, 'matches');
  // match_date >= şu an: aksi halde (aynı alanda where+orderBy, composite
  // index gerekmiyor) sonuçlanmış eski maçlar da sorguya girip "en eski
  // tarihli kayıt" olarak sahte biçimde güncel gösterilebiliyordu — site
  // yeniyken (hiç sonuçlanmış maç yokken) bu görünmüyordu, geçmiş veri
  // birikince ortaya çıktı.
  const q = query(matchesRef, where('match_date', '>=', Timestamp.now()), orderBy('match_date', 'asc'), limit(150));
  const snap = await getDocs(q);
  const soonestByComp = new Map();
  snap.forEach(function (doc) {
    const m = doc.data();
    if (!soonestByComp.has(m.competition_code)) soonestByComp.set(m.competition_code, m); // sorgu tarihe göre artan, ilk görülen = en yakın
  });
  const matches = Array.from(soonestByComp.values())
    .sort(function (a, b) { return a.match_date.toMillis() - b.match_date.toMillis(); });
  renderMatches(el, matches, 'Henüz analiz eklenmedi, ilk otomatik güncelleme yakında çalışacak.');
}

async function loadAnalizler() {
  const el = document.getElementById('analizList');
  if (!el) return;

  try {
    await loadGenel(el);
  } catch (err) {
    console.error('Analizler yüklenemedi:', err);
    el.innerHTML = '<div class="trow"><div>Analizler şu an yüklenemedi, daha sonra tekrar dene.</div></div>';
  }
}

async function loadMatchCount() {
  const el = document.getElementById('statMatchCount');
  if (!el) return;
  try {
    const snap = await getCountFromServer(collection(db, 'matches'));
    el.innerHTML = '<b>' + snap.data().count + '</b>Takip Edilen Maç';
  } catch (err) {
    console.error('Maç sayısı alınamadı:', err);
  }
}

function setupWaitlist() {
  const box = document.getElementById('waitlistBox');
  const emailInput = document.getElementById('waitlistEmail');
  const submitBtn = document.getElementById('waitlistSubmit');
  const status = document.getElementById('waitlistStatus');
  if (!box || !emailInput || !submitBtn) return;
  let selectedPlan = 'premium';

  document.querySelectorAll('.waitlist-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectedPlan = btn.getAttribute('data-plan') || 'premium';
      box.style.display = 'block';
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      emailInput.focus();
    });
  });

  submitBtn.addEventListener('click', async function () {
    const email = (emailInput.value || '').trim();
    if (!email || !email.includes('@')) {
      status.textContent = 'Geçerli bir e-posta adresi gir.';
      status.style.color = '#e5484d';
      return;
    }
    submitBtn.disabled = true;
    try {
      await addDoc(collection(db, 'premium_interest'), {
        email: email,
        plan: selectedPlan,
        created_at: Timestamp.now()
      });
      status.textContent = 'Teşekkürler, hazır olduğunda haber vereceğiz.';
      status.style.color = '#12b76a';
      emailInput.value = '';
    } catch (err) {
      console.error('Kayıt başarısız:', err);
      status.textContent = 'Bir şeyler ters gitti, tekrar dener misin?';
      status.style.color = '#e5484d';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function loadSiteConfig() {
  try {
    const snap = await getDoc(doc(db, 'site_config', 'main'));
    if (!snap.exists()) return;
    const cfg = snap.data();

    const social = cfg.social || {};
    document.querySelectorAll('#socialRow a[data-platform]').forEach(function (a) {
      const key = a.getAttribute('data-platform');
      const s = social[key];
      if (s && s.enabled && s.url) { a.href = s.url; a.style.display = 'flex'; }
      else { a.style.display = 'none'; }
    });

    const pricing = cfg.pricing || {};
    ['free', 'premium', 'yearly'].forEach(function (key) {
      const p = pricing[key];
      if (!p) return;
      const priceEl = document.querySelector('[data-price="' + key + '"]');
      const periodEl = document.querySelector('[data-period="' + key + '"]');
      if (priceEl) priceEl.textContent = p.price + (pricing.currency || '₺');
      if (periodEl) periodEl.textContent = p.period;
    });
  } catch (err) {
    console.error('Site ayarları yüklenemedi:', err);
  }
}

loadAnalizler();
loadMatchCount();
setupWaitlist();
loadSiteConfig();
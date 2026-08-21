import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, query, orderBy, limit, getDocs
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

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function formatDateLong(ts) {
  try {
    return ts.toDate().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

function formatDateShort(ts) {
  try {
    return ts.toDate().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  } catch (e) { return ''; }
}

function emptyCardHtml(message) {
  return '<div class="empty-card">' + message + '</div>';
}

function renderMeter(el, rate, hasData) {
  const size = 96, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const dash = hasData ? (rate / 100) * c : 0;
  el.innerHTML =
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--accent-soft)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="' + stroke + '" stroke-linecap="round" ' +
        'stroke-dasharray="' + dash + ' ' + (c - dash) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="54%" text-anchor="middle" class="meter-pct">' + (hasData ? '%' + rate : '—') + '</text>' +
    '</svg>';
}

// Takip ettiğimiz 9 büyük lig — sabit liste. Bar grafik SADECE veri
// biriken ligleri göstermek yerine hepsini gösterir (veri yoksa "henüz
// veri yok" ile) — yoksa ana sayfadaki "9 Büyük Lig" iddiasıyla bu
// sayfadaki (o an sonuçlanmış maçı olmayan ligleri sessizce atlayan)
// liste birbirini tutmuyormuş gibi görünüyordu (kullanıcı fark etti).
var TRACKED_LEAGUES = [
  { code: 'PL', name: 'Premier Lig' },
  { code: 'PD', name: 'La Liga' },
  { code: 'BL1', name: 'Bundesliga' },
  { code: 'SA', name: 'Serie A' },
  { code: 'FL1', name: 'Ligue 1' },
  { code: 'DED', name: 'Eredivisie' },
  { code: 'PPL', name: 'Primeira Liga' },
  { code: 'ELC', name: 'Championship' },
  { code: 'BSA', name: 'Brasileirão' }
];

function renderBarChart(el, groupsByCode) {
  const withData = [];
  const withoutData = [];
  TRACKED_LEAGUES.forEach(function (league) {
    const g = groupsByCode.get(league.code);
    if (g) withData.push(g);
    else withoutData.push({ name: league.name, total: 0, rate: null });
  });
  // Ekstra takip edilen turnuvalar (ör. kıtasal kupalar) — sabit 9 lig
  // dışında ama veri varsa göster.
  groupsByCode.forEach(function (g, code) {
    if (!TRACKED_LEAGUES.some(function (l) { return l.code === code; })) withData.push(g);
  });
  withData.sort(function (a, b) { return b.rate - a.rate || b.total - a.total; });

  const dataRows = withData.map(function (g) {
    return (
      '<div class="bar-row">' +
        '<div class="bar-label">' + escapeHtml(g.name) + ' <span class="bar-n">(' + g.total + ' maç)</span></div>' +
        '<div class="bar-track">' +
          '<div class="baseline" title="Rastgele tahmin referansı: %33"></div>' +
          '<div class="bar-fill" style="width:' + g.rate + '%"></div>' +
          '<span class="bar-value" style="--w:' + g.rate + '%">%' + g.rate + '</span>' +
        '</div>' +
      '</div>'
    );
  }).join('');
  const emptyRows = withoutData.map(function (g) {
    return (
      '<div class="bar-row bar-row-empty">' +
        '<div class="bar-label">' + escapeHtml(g.name) + '</div>' +
        '<div class="bar-track bar-track-empty"><span class="bar-empty-label">henüz veri yok</span></div>' +
      '</div>'
    );
  }).join('');
  el.innerHTML = '<div class="bar-chart-card"><div class="bar-list">' + dataRows + emptyRows + '</div></div>';
}

function outcomeLabel(code, homeTeam, awayTeam) {
  if (code === 'H') return escapeHtml(homeTeam) + ' kazanır';
  if (code === 'A') return escapeHtml(awayTeam) + ' kazanır';
  return 'Beraberlik';
}

function probItemClass(m, code) {
  const classes = ['prob-item'];
  if (m.predicted_result === code) classes.push('picked');
  if (m.actual_result === code) classes.push('actual-outcome');
  return classes.join(' ');
}

function renderHistoryTable(el, matches, nearestUpcoming) {
  if (matches.length === 0) {
    const hint = nearestUpcoming
      ? ' İlk tahminlerimiz ' + formatDateShort(nearestUpcoming) + ' itibariyle sonuçlanmaya başlayacak — o zamana kadar burası boş kalacak, gizlemiyoruz.'
      : '';
    el.innerHTML = emptyCardHtml('<b>Henüz sonuçlanmış maç yok.</b><br>' + 'Formül11 çok yeni, ilk tahminlerimiz henüz oynanmadı.' + hint);
    return;
  }

  el.innerHTML = '<div class="table-wrap"></div>';
  const wrap = el.querySelector('.table-wrap');

  matches.forEach(function (m) {
    const row = document.createElement('div');
    row.className = 'hrow';
    const badge = m.hit
      ? '<span class="status-badge hit">✓ İsabet</span>'
      : '<span class="status-badge miss">✕ İsabetsiz</span>';
    const hasOu = m.predicted_ou != null;
    const ouBadge = hasOu
      ? (m.ou_hit
          ? '<span class="status-badge hit">✓ Gol</span>'
          : '<span class="status-badge miss">✕ Gol</span>')
      : '';
    const ouLabel = function (code) { return code === 'OVER' ? '2.5 Üst' : '2.5 Alt'; };
    const ouDetail = hasOu
      ? '<div class="hrow-meta" style="margin-top:6px;">Toplam gol tahminimiz: ' + ouLabel(m.predicted_ou) +
        ' (' + m.actual_total_goals + ' gol oynandı, gerçekleşen: ' + ouLabel(m.actual_ou) + ')</div>'
      : '';

    row.innerHTML =
      '<div class="hrow-head">' +
        '<div class="hrow-teams">' +
          '<div class="hrow-date">' + formatDateLong(m.match_date) + ' · ' + escapeHtml(m.competition_name) + '</div>' +
          '<div class="hrow-match">' + escapeHtml(m.home_team) + ' ' + m.actual_home_goals + '-' + m.actual_away_goals + ' ' + escapeHtml(m.away_team) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' + badge + ouBadge + '</div>' +
      '</div>' +
      '<div class="hrow-detail">' +
        '<div class="prob-grid">' +
          '<div class="' + probItemClass(m, 'H') + '"><b>%' + m.home_win_prob + '</b><span>' + escapeHtml(m.home_team) + '</span></div>' +
          '<div class="' + probItemClass(m, 'D') + '"><b>%' + m.draw_prob + '</b><span>Beraberlik</span></div>' +
          '<div class="' + probItemClass(m, 'A') + '"><b>%' + m.away_win_prob + '</b><span>' + escapeHtml(m.away_team) + '</span></div>' +
        '</div>' +
        '<div class="hrow-meta">Tahminimiz: ' + outcomeLabel(m.predicted_result, m.home_team, m.away_team) +
          ' · Gerçekleşen: ' + outcomeLabel(m.actual_result, m.home_team, m.away_team) + '</div>' +
        ouDetail +
      '</div>';

    row.addEventListener('click', function () { row.classList.toggle('open'); });
    wrap.appendChild(row);
  });
}

async function loadHistory() {
  const matchesRef = collection(db, 'matches');
  const q = query(matchesRef, orderBy('match_date', 'desc'), limit(500));
  const snap = await getDocs(q);
  const all = [];
  snap.forEach(function (d) { all.push(d.data()); });

  const evaluated = all.filter(function (m) { return m.evaluated === true; });
  const now = Date.now();
  const upcoming = all.filter(function (m) {
    return m.evaluated !== true && m.match_date && m.match_date.toMillis() > now;
  });
  let nearestUpcoming = null;
  upcoming.forEach(function (m) {
    if (!nearestUpcoming || m.match_date.toMillis() < nearestUpcoming.toMillis()) nearestUpcoming = m.match_date;
  });

  const total = evaluated.length;
  const hits = evaluated.filter(function (m) { return m.hit === true; }).length;
  const rate = total ? Math.round((hits / total) * 100) : 0;

  document.getElementById('tileTotal').textContent = total ? String(total) : '—';
  document.getElementById('tileHits').textContent = total ? hits + ' / ' + total : '—';
  renderMeter(document.getElementById('meterWrap'), rate, total > 0);
  document.getElementById('tileRateNote').textContent = total ? 'sonuçlanan maçlarda' : 'veri bekleniyor';

  const deltaEl = document.getElementById('tileDelta');
  if (total >= 5) {
    const delta = rate - 33;
    deltaEl.textContent = (delta >= 0 ? '+' : '') + delta + ' puan · rastgele: %33';
    deltaEl.className = 'tile-delta ' + (delta > 0 ? 'pos' : 'neutral');
  } else {
    deltaEl.textContent = 'rastgele: %33';
    deltaEl.className = 'tile-delta neutral';
  }

  const groupMap = new Map();
  evaluated.forEach(function (m) {
    const key = m.competition_code || m.competition_name;
    if (!groupMap.has(key)) groupMap.set(key, { name: m.competition_name, total: 0, hits: 0 });
    const g = groupMap.get(key);
    g.total++;
    if (m.hit) g.hits++;
  });
  groupMap.forEach(function (g) { g.rate = Math.round((g.hits / g.total) * 100); });

  renderBarChart(document.getElementById('barChartArea'), groupMap);
  renderHistoryTable(document.getElementById('historyTable'), evaluated, nearestUpcoming);
}

loadHistory().catch(function (err) {
  console.error('Geçmiş analizler yüklenemedi:', err);
  document.getElementById('barChartArea').innerHTML = emptyCardHtml('Veriler şu an yüklenemedi, daha sonra tekrar dene.');
  document.getElementById('historyTable').innerHTML = '';
});

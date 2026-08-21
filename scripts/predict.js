// Formül11 veri/tahmin pipeline'ı.
// Günde bir kez (GitHub Actions cron) çalışır:
//  1) football-data.org'dan ücretsiz plana dahil liglerin puan durumunu çeker
//  2) Takım hücum/savunma güçlerini geçmiş performanstan çıkarır
//  3) Yaklaşan maçlar için Poisson dağılımıyla 1-X-2 olasılığı hesaplar
//  4) Sonucu Firestore "matches" koleksiyonuna yazar (client bunu okur)
//
// Şeffaflık ilkesi (sss.html'de vaat edildi): model "takım formu + karşılıklı
// geçmiş maçlar" gibi halka açık istatistiklerden olasılık üretir, gizli/
// uydurma bir "AI motoru" değildir.

import admin from "firebase-admin";
import fs from "node:fs";

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
if (!API_KEY) {
  console.error("FOOTBALL_DATA_API_KEY env değişkeni yok, çıkılıyor.");
  process.exit(1);
}

// football-data.org ücretsiz plana (TIER_ONE) dahil ligler. Not: TR1 (Süper
// Lig) bu planda YOK — /v4/competitions ile teyit edildi, eklenmedi.
const COMPETITIONS = [
  { code: "PL", name: "Premier Lig" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
  { code: "DED", name: "Eredivisie" },
  { code: "PPL", name: "Primeira Liga" },
  { code: "ELC", name: "Championship" },
  { code: "BSA", name: "Brasileirão" },
];

// Kıtasal kupalar: standings/puan durumu yok (grup aşaması bitmiş olabilir,
// eleme usulü oynanıyor olabilir), o yüzden ayrı ele alınıyor — her iki takım
// da yukarıdaki 9 ligden birinde zaten takip ediliyorsa (aynı football-data.org
// takım ID sistemi ligler arasında ortak) o ligin form verisiyle tahmin
// üretiliyor, değilse (çoğu maç — rakip başka bir ülkenin liginden) sessizce
// atlanıyor. football-data.org'da yeni kayıt/ek maliyet gerektirmiyor, zaten
// kullandığımız plana dahil.
const CONTINENTAL_CUPS = [
  { code: "CLI", name: "Copa Libertadores" },
  { code: "CL", name: "UEFA Şampiyonlar Ligi" },
];

const BASE_URL = "https://api.football-data.org/v4";
const HOME_ADVANTAGE = 1.12;
const MAX_GOALS = 6; // Poisson toplamı için pratik üst sınır

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (res.status === 429) {
    console.warn("Rate limit, 60sn bekleniyor...");
    await sleep(60_000);
    return apiGet(path);
  }
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchFinishedMatches(code, seasonYear) {
  const q = seasonYear ? `?status=FINISHED&season=${seasonYear}` : `?status=FINISHED`;
  const res = await apiGet(`/competitions/${code}/matches${q}`);
  return res.matches || [];
}

function poissonPmf(k, lambda) {
  // lambda tam 0 olursa (ör. bir takım sezonun ilk maçında 0 gol atmış/yemiş
  // ve o istatistik doğrudan beklenen gol ortalamasına giriyor) Math.log(0)
  // -Infinity veriyor, k=0 için 0 * -Infinity = NaN oluyor ve tüm olasılık
  // hesabını (1-X-2 + alt/üst) NaN'a çeviriyor. Küçük bir taban değer
  // (epsilon) hem NaN'ı önlüyor hem de istatistiksel olarak daha doğru —
  // tek maçlık örneklemden "bu takım asla gol atmaz/yemez" sonucu çıkarmak
  // aşırı iddialı olurdu.
  lambda = Math.max(lambda, 1e-6);
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Dixon-Coles (1997) düşük skor düzeltmesi: bağımsız Poisson varsayımı
// (ev/deplasman gollerinin birbirinden tamamen bağımsız olduğu) gerçekte
// düşük skorlu maçlarda (özellikle beraberliklerde) sapıyor — saf Poisson
// modeli beraberlik olasılığını sistematik olarak düşük hesaplıyor. Dixon &
// Coles'un orijinal makalesinde İngiltere ligleri için kestirilen rho
// (~-0.13) burada da kullanılıyor; kendi verimizden rho kestirmek için
// (henüz) yeterli maç/sonuç birikmedi, literatürdeki standart değer
// belgelenmiş bir yaklaşıklık olarak uygulanıyor.
const DIXON_COLES_RHO = -0.13;

function dixonColesTau(h, a, lambdaHome, lambdaAway, rho) {
  if (h === 0 && a === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (h === 1 && a === 0) return 1 + lambdaAway * rho;
  if (h === 0 && a === 1) return 1 + lambdaHome * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// Tüm skor ızgarasını (0-0'dan MAX_GOALS-MAX_GOALS'a) tek seferde kurar,
// hem 1-X-2 hem toplam gol alt/üst olasılıkları buradan aynı ızgaradan
// türetilir — böylece iki tahmin türü birbirinden bağımsız/tutarsız
// hesaplanmış olmaz.
function buildScoreGrid(lambdaHome, lambdaAway) {
  const grid = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      let p =
        poissonPmf(h, lambdaHome) *
        poissonPmf(a, lambdaAway) *
        dixonColesTau(h, a, lambdaHome, lambdaAway, DIXON_COLES_RHO);
      if (p < 0) p = 0; // rho teorik uçlarda negatif üretebilir, güvenlik payı
      grid[h][a] = p;
      total += p;
    }
  }
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) grid[h][a] /= total; // kuyruk kesiminden kalan artığı normalize et
  }
  return grid;
}

// Beklenen gol ortalamalarından 1-X-2 ve 2.5 alt/üst toplam gol olasılıklarını hesaplar.
function matchProbabilities(lambdaHome, lambdaAway) {
  const grid = buildScoreGrid(lambdaHome, lambdaAway);
  let pHome = 0, pDraw = 0, pAway = 0, pOver25 = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = grid[h][a];
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
      if (h + a > 2.5) pOver25 += p;
    }
  }
  return { pHome, pDraw, pAway, pOver25, pUnder25: 1 - pOver25 };
}

// Bir takımın "son form"unu değerlendirirken kaç maçına bakılacağı — sezon
// başından beri biriken TÜM maçların düz ortalaması yerine (eski yöntem),
// son RECENT_FORM_GAMES maça bakmak güncel formu (sakatlık, teknik direktör
// değişikliği, moral vb.) çok daha iyi yansıtıyor. Futbol analitiğinde
// bilinen, standart bir iyileştirme.
const RECENT_FORM_GAMES = 8;

// Az maçlı takımların (ör. sezonun ilk haftalarında) katsayısını lig
// ortalamasına doğru "büzen" (shrinkage) Bayesyen ağırlık — K kadar
// "hayali ortalama maç" varmış gibi davranır. Maç sayısı arttıkça takımın
// gerçek formu ağır basar. Bu olmadan 1-2 maçlık şanslı/şanssız bir seri
// aşırı iddialı (overconfident) bir tahmine yol açabiliyordu.
const SHRINKAGE_PRIOR_GAMES = 5;

// Bitmiş maç listesinden (her maç: homeTeam/awayTeam/score.fullTime) takım
// başına son-form hücum/savunma katsayıları çıkarır. Eskiden sezon
// standings'inin TOTAL satırındaki düz ortalama kullanılıyordu — bu hem
// erken sezonda ekstra bir API çağrısı (standings) gerektiriyordu hem de
// güncel formu değil tüm sezonu yansıtıyordu.
function buildTeamStrengthsFromMatches(matches) {
  const byTeam = new Map(); // teamId -> { name, games: [{scored, conceded, date}] }
  for (const m of matches) {
    const hg = m.score?.fullTime?.home;
    const ag = m.score?.fullTime?.away;
    const home = m.homeTeam, away = m.awayTeam;
    if (hg == null || ag == null || !home?.id || !away?.id) continue;
    if (!byTeam.has(home.id)) byTeam.set(home.id, { name: home.name, games: [] });
    if (!byTeam.has(away.id)) byTeam.set(away.id, { name: away.name, games: [] });
    byTeam.get(home.id).games.push({ scored: hg, conceded: ag, date: m.utcDate });
    byTeam.get(away.id).games.push({ scored: ag, conceded: hg, date: m.utcDate });
  }

  // Her takımın son N maçını seç, lig ortalamasını bu pencerelerin
  // üzerinden hesapla (tutarlılık için — attack/defense de aynı pencereye
  // göre normalize edilecek).
  const recentByTeam = new Map();
  let totalGoals = 0, totalGames = 0;
  for (const [id, t] of byTeam) {
    const recent = [...t.games]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, RECENT_FORM_GAMES);
    recentByTeam.set(id, { name: t.name, games: recent });
    totalGoals += recent.reduce((s, g) => s + g.scored, 0);
    totalGames += recent.length;
  }
  if (totalGames === 0) return { strengths: {}, leagueAvgGoals: 0 };
  const leagueAvgGoals = totalGoals / totalGames;

  const strengths = {};
  for (const [id, t] of recentByTeam) {
    const played = t.games.length;
    if (played === 0) continue;
    const avgScored = t.games.reduce((s, g) => s + g.scored, 0) / played;
    const avgConceded = t.games.reduce((s, g) => s + g.conceded, 0) / played;
    const K = SHRINKAGE_PRIOR_GAMES;
    // Bayesyen büzülme: (gözlem × played + lig_ortalaması(=1.0) × K) / (played + K)
    const attack = (played * (avgScored / leagueAvgGoals) + K * 1.0) / (played + K);
    const defense = (played * (avgConceded / leagueAvgGoals) + K * 1.0) / (played + K);
    strengths[id] = { name: t.name, attack, defense };
  }
  return { strengths, leagueAvgGoals };
}

function confidenceLabel(pHome, pDraw, pAway) {
  const max = Math.max(pHome, pDraw, pAway);
  return Math.round(max * 100);
}

function loadServiceAccount() {
  // GitHub Actions'ta secret olarak tüm JSON içeriği env değişkenine konur.
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  // Lokal geliştirmede repo kökündeki (gitignore'lu) dosyadan okunur.
  return JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
}

async function run() {
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const batch = db.batch();
  let written = 0;
  const globalStrengths = {}; // team id -> {name, attack, defense, leagueAvgGoals} — kıtasal kupalar için de kullanılacak

  for (const comp of COMPETITIONS) {
    try {
      console.log(`-> ${comp.name} (${comp.code}) sonuçlanan maçlar çekiliyor...`);
      let finished = await fetchFinishedMatches(comp.code);

      // Sezon henüz başlamadıysa (ör. yaz arası, 0 bitmiş maç) bir önceki
      // tamamlanmış sezona düş — Serie A/Ligue 1/Eredivisie/Championship'te
      // sezon geçişinde tam bu yüzden hiç tahmin üretilmiyordu.
      if (finished.length === 0) {
        const prevYear = new Date().getUTCFullYear() - 1;
        console.log(`${comp.name}: güncel sezonda bitmiş maç yok, ${prevYear} sezonuna düşülüyor...`);
        await sleep(6500);
        finished = await fetchFinishedMatches(comp.code, prevYear);
      }

      if (finished.length === 0) {
        console.warn(`${comp.code}: bitmiş maç verisi yok, atlanıyor`);
        await sleep(6500);
        continue;
      }
      const { strengths, leagueAvgGoals } = buildTeamStrengthsFromMatches(finished);
      for (const teamId of Object.keys(strengths)) {
        globalStrengths[teamId] = { ...strengths[teamId], leagueAvgGoals };
      }

      await sleep(6500); // ücretsiz plan: 10 istek/dk sınırı

      console.log(`-> ${comp.name} yaklaşan maçlar çekiliyor...`);
      const matchesRes = await apiGet(`/competitions/${comp.code}/matches?status=SCHEDULED`);
      const upcoming = (matchesRes.matches || []).slice(0, 10);

      for (const m of upcoming) {
        const home = strengths[m.homeTeam.id];
        const away = strengths[m.awayTeam.id];
        if (!home || !away) continue; // yeni terfi eden takım, yeterli veri yok

        const lambdaHome = leagueAvgGoals * home.attack * away.defense * HOME_ADVANTAGE;
        const lambdaAway = leagueAvgGoals * away.attack * home.defense;
        const { pHome, pDraw, pAway, pOver25, pUnder25 } = matchProbabilities(lambdaHome, lambdaAway);

        const docId = `fd-${m.id}`;
        const ref = db.collection("matches").doc(docId);
        batch.set(ref, {
          source: "football-data.org",
          competition_code: comp.code,
          competition_name: comp.name,
          home_team: m.homeTeam.name,
          away_team: m.awayTeam.name,
          match_date: admin.firestore.Timestamp.fromDate(new Date(m.utcDate)),
          home_win_prob: Math.round(pHome * 100),
          draw_prob: Math.round(pDraw * 100),
          away_win_prob: Math.round(pAway * 100),
          over_2_5_prob: Math.round(pOver25 * 100),
          under_2_5_prob: Math.round(pUnder25 * 100),
          confidence: confidenceLabel(pHome, pDraw, pAway),
          model: "poisson-dc-v3",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        written++;
      }

      await sleep(6500);
    } catch (err) {
      console.error(`${comp.code} işlenirken hata:`, err.message);
    }
  }

  written += await runContinentalCups(db, batch, globalStrengths);

  if (written > 0) {
    await batch.commit();
    console.log(`${written} maç tahmini Firestore'a yazıldı.`);
  } else {
    console.log("Yazılacak yeni maç bulunamadı.");
  }
}

async function runContinentalCups(db, batch, globalStrengths) {
  let written = 0;
  for (const comp of CONTINENTAL_CUPS) {
    try {
      console.log(`-> ${comp.name} (${comp.code}) yaklaşan maçlar çekiliyor...`);
      const matchesRes = await apiGet(`/competitions/${comp.code}/matches?status=SCHEDULED`);
      const upcoming = (matchesRes.matches || [])
        .filter((m) => m.homeTeam?.id && m.awayTeam?.id)
        .slice(0, 15);

      for (const m of upcoming) {
        const home = globalStrengths[m.homeTeam.id];
        const away = globalStrengths[m.awayTeam.id];
        if (!home || !away) continue; // takımlardan biri takip ettiğimiz 9 ligin dışından

        // İki takım farklı liglerden gelebilir (ör. Brezilya-Arjantin), o
        // yüzden tek bir "leagueAvgGoals" yok — ikisinin ortalaması alınıyor.
        const avgGoals = (home.leagueAvgGoals + away.leagueAvgGoals) / 2;
        const lambdaHome = avgGoals * home.attack * away.defense * HOME_ADVANTAGE;
        const lambdaAway = avgGoals * away.attack * home.defense;
        const { pHome, pDraw, pAway, pOver25, pUnder25 } = matchProbabilities(lambdaHome, lambdaAway);

        const ref = db.collection("matches").doc(`fd-${m.id}`);
        batch.set(ref, {
          source: "football-data.org",
          competition_code: comp.code,
          competition_name: comp.name,
          home_team: m.homeTeam.name,
          away_team: m.awayTeam.name,
          match_date: admin.firestore.Timestamp.fromDate(new Date(m.utcDate)),
          home_win_prob: Math.round(pHome * 100),
          draw_prob: Math.round(pDraw * 100),
          away_win_prob: Math.round(pAway * 100),
          over_2_5_prob: Math.round(pOver25 * 100),
          under_2_5_prob: Math.round(pUnder25 * 100),
          confidence: confidenceLabel(pHome, pDraw, pAway),
          model: "poisson-dc-v3",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        written++;
      }
      await sleep(6500);
    } catch (err) {
      console.error(`${comp.code} işlenirken hata:`, err.message);
    }
  }
  return written;
}

run().catch((err) => {
  console.error("Pipeline hata verdi:", err);
  process.exit(1);
});
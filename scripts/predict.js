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

// Normalize edilmiş { id, goalsFor, goalsAgainst, played } listesinden
// takım hücum/savunma katsayıları çıkarır. Hem football-data.org hem
// TheSportsDB kaynaklı veri bu ortak formata çevrilip buraya veriliyor.
function buildTeamStrengths(teamRows) {
  const teams = teamRows.filter((t) => t.played > 0);
  const leagueAvgGoals =
    teams.reduce((s, t) => s + t.goalsFor / t.played, 0) / teams.length;

  const strengths = {};
  for (const t of teams) {
    strengths[t.id] = {
      name: t.name,
      attack: t.goalsFor / t.played / leagueAvgGoals,
      defense: t.goalsAgainst / t.played / leagueAvgGoals,
    };
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
      console.log(`-> ${comp.name} (${comp.code}) puan durumu çekiliyor...`);
      const standingsRes = await apiGet(`/competitions/${comp.code}/standings`);
      let table = standingsRes.standings?.find((s) => s.type === "TOTAL")?.table || [];

      // football-data.org "current season" bazen yeni sezona geçmiş oluyor
      // (henüz hiç maç oynanmamış, herkes 0 puan/0 maç). Bu durumda takım
      // güçlerini hesaplayacak veri kalmıyor ve her maç sessizce atlanıyor
      // (Serie A/Ligue 1/Eredivisie/Championship'te tam bu yüzden hiç yazı
      // çıkmıyordu). Çözüm: bir önceki (tamamlanmış) sezona düş.
      const hasPlayedData = table.some((t) => t.playedGames > 0);
      if (table.length > 0 && !hasPlayedData) {
        const seasonStartYear = standingsRes.season?.startDate
          ? new Date(standingsRes.season.startDate).getUTCFullYear()
          : new Date().getUTCFullYear();
        const prevYear = seasonStartYear - 1;
        console.log(`${comp.name}: yeni sezon henüz oynanmadı, ${prevYear} sezonuna düşülüyor...`);
        await sleep(6500);
        const prevRes = await apiGet(`/competitions/${comp.code}/standings?season=${prevYear}`);
        table = prevRes.standings?.find((s) => s.type === "TOTAL")?.table || [];
      }

      if (table.length === 0) {
        console.warn(`${comp.code}: puan durumu boş, atlanıyor`);
        await sleep(6500);
        continue;
      }
      const teamRows = table.map((t) => ({
        id: t.team.id,
        name: t.team.name,
        played: t.playedGames,
        goalsFor: t.goalsFor,
        goalsAgainst: t.goalsAgainst,
      }));
      const { strengths, leagueAvgGoals } = buildTeamStrengths(teamRows);
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
          model: "poisson-dc-v2",
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
          model: "poisson-dc-v2",
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
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

// --- Türkiye Süper Lig: TheSportsDB'nin herkese açık test anahtarı ("3") ---
// Kayıt gerektirmiyor, football-data.org ücretsiz planında olmayan Süper
// Lig'i buradan çekiyoruz. league id 4339 = "Turkish Super Lig".
const TSD_BASE = "https://www.thesportsdb.com/api/v1/json/3";
const TSD_LEAGUE_ID = "4339";

function currentTurkishSeason(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-12
  return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

async function tsdGet(path) {
  const res = await fetch(`${TSD_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchTurkishSuperLigTable() {
  const season = currentTurkishSeason();
  let table = (await tsdGet(`/lookuptable.php?l=${TSD_LEAGUE_ID}&s=${season}`)).table || [];
  const totalPlayed = table.reduce((s, t) => s + Number(t.intPlayed || 0), 0);
  if (totalPlayed === 0) {
    // Yeni sezon henüz başlamamış (ör. yaz arası) — bir önceki sezona düş.
    const [startY] = season.split("-").map(Number);
    const prevSeason = `${startY - 1}-${startY}`;
    console.log(`TSL: ${season} sezonu boş, ${prevSeason} sezonuna düşülüyor.`);
    await sleep(2000);
    table = (await tsdGet(`/lookuptable.php?l=${TSD_LEAGUE_ID}&s=${prevSeason}`)).table || [];
  }
  return table;
}

async function runTurkishSuperLig(db, batch) {
  console.log("-> Süper Lig (TSL, TheSportsDB) puan durumu çekiliyor...");
  try {
    const table = await fetchTurkishSuperLigTable();
    if (table.length === 0) {
      console.warn("TSL: puan durumu alınamadı, atlanıyor.");
      return 0;
    }
    const teamRows = table.map((t) => ({
      id: t.idTeam,
      name: t.strTeam,
      played: Number(t.intPlayed || 0),
      goalsFor: Number(t.intGoalsFor || 0),
      goalsAgainst: Number(t.intGoalsAgainst || 0),
    }));
    const { strengths, leagueAvgGoals } = buildTeamStrengths(teamRows);

    await sleep(2000);
    console.log("-> Süper Lig yaklaşan maçlar çekiliyor...");
    const eventsRes = await tsdGet(`/eventsnextleague.php?id=${TSD_LEAGUE_ID}`);
    const upcoming = (eventsRes.events || []).slice(0, 15);

    let written = 0;
    for (const ev of upcoming) {
      const home = strengths[ev.idHomeTeam];
      const away = strengths[ev.idAwayTeam];
      if (!home || !away) continue;

      const lambdaHome = leagueAvgGoals * home.attack * away.defense * HOME_ADVANTAGE;
      const lambdaAway = leagueAvgGoals * away.attack * home.defense;
      const { pHome, pDraw, pAway, pOver25, pUnder25 } = matchProbabilities(lambdaHome, lambdaAway);

      const matchDate = ev.strTimestamp
        ? new Date(ev.strTimestamp)
        : new Date(`${ev.dateEvent}T${ev.strTime || "00:00:00"}Z`);

      const ref = db.collection("matches").doc(`tsd-${ev.idEvent}`);
      batch.set(ref, {
        source: "thesportsdb.com",
        competition_code: "TSL",
        competition_name: "Süper Lig",
        home_team: ev.strHomeTeam,
        away_team: ev.strAwayTeam,
        match_date: admin.firestore.Timestamp.fromDate(matchDate),
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
    return written;
  } catch (err) {
    console.error("TSL işlenirken hata:", err.message);
    return 0;
  }
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

  written += await runTurkishSuperLig(db, batch);

  if (written > 0) {
    await batch.commit();
    console.log(`${written} maç tahmini Firestore'a yazıldı.`);
  } else {
    console.log("Yazılacak yeni maç bulunamadı.");
  }
}

run().catch((err) => {
  console.error("Pipeline hata verdi:", err);
  process.exit(1);
});
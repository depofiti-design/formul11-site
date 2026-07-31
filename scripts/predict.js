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

// Beklenen gol ortalamalarından 1-X-2 olasılıklarını hesaplar.
function matchProbabilities(lambdaHome, lambdaAway) {
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
    }
  }
  const total = pHome + pDraw + pAway; // kuyruk kesiminden kalan artığı normalize et
  return { pHome: pHome / total, pDraw: pDraw / total, pAway: pAway / total };
}

// Puan durumundan takım hücum/savunma katsayıları çıkarır.
function buildTeamStrengths(standingsTable) {
  const teams = standingsTable.filter((t) => t.playedGames > 0);
  const leagueAvgGoals =
    teams.reduce((s, t) => s + t.goalsFor / t.playedGames, 0) / teams.length;

  const strengths = {};
  for (const t of teams) {
    strengths[t.team.id] = {
      name: t.team.name,
      attack: t.goalsFor / t.playedGames / leagueAvgGoals,
      defense: t.goalsAgainst / t.playedGames / leagueAvgGoals,
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

  for (const comp of COMPETITIONS) {
    try {
      console.log(`-> ${comp.name} (${comp.code}) puan durumu çekiliyor...`);
      const standingsRes = await apiGet(`/competitions/${comp.code}/standings`);
      const table = standingsRes.standings?.find((s) => s.type === "TOTAL")?.table || [];
      if (table.length === 0) {
        console.warn(`${comp.code}: puan durumu boş, atlanıyor`);
        await sleep(6500);
        continue;
      }
      const { strengths, leagueAvgGoals } = buildTeamStrengths(table);

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
        const { pHome, pDraw, pAway } = matchProbabilities(lambdaHome, lambdaAway);

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
          confidence: confidenceLabel(pHome, pDraw, pAway),
          model: "poisson-form-v1",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        written++;
      }

      await sleep(6500);
    } catch (err) {
      console.error(`${comp.code} işlenirken hata:`, err.message);
    }
  }

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
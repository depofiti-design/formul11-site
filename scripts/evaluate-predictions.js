// Formül11 — geçmiş tahminleri gerçek sonuçlarla karşılaştırır.
// Günde bir kez (predict.js'den hemen sonra, aynı cron) çalışır:
//  1) Firestore "matches" koleksiyonundaki, tarihi geçmiş ama henüz
//     değerlendirilmemiş (evaluated != true) dokümanları bulur
//  2) Kaynağına göre (football-data.org / TheSportsDB) gerçek skoru çeker
//  3) Maç bittiyse tahmin edilen sonuç (en yüksek olasılıklı 1-X-2) ile
//     gerçek sonucu karşılaştırıp isabet/isabetsiz olarak işaretler
//
// Bu, sitedeki "Açık Performans Kaydı" vaadinin (index.html) veri
// kaynağıdır — gecmis-analizler.html bu alanları okuyor.

import admin from "firebase-admin";
import fs from "node:fs";

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
if (!API_KEY) {
  console.error("FOOTBALL_DATA_API_KEY env değişkeni yok, çıkılıyor.");
  process.exit(1);
}

const BASE_URL = "https://api.football-data.org/v4";
const TSD_BASE = "https://www.thesportsdb.com/api/v1/json/3";
const MAX_PER_RUN = 50; // ücretsiz plan hızını korumak için tek çalıştırmada üst sınır

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fdGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (res.status === 429) {
    console.warn("Rate limit, 60sn bekleniyor...");
    await sleep(60_000);
    return fdGet(path);
  }
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function tsdGet(path) {
  const res = await fetch(`${TSD_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function predictedResult(m) {
  const max = Math.max(m.home_win_prob, m.draw_prob, m.away_win_prob);
  if (m.home_win_prob === max) return "H";
  if (m.draw_prob === max) return "D";
  return "A";
}

function actualResult(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return "H";
  if (homeGoals < awayGoals) return "A";
  return "D";
}

async function evaluateFootballData(doc) {
  const id = doc.id.replace(/^fd-/, "");
  const data = await fdGet(`/matches/${id}`);
  if (data.status !== "FINISHED") return null;
  const home = data.score?.fullTime?.home;
  const away = data.score?.fullTime?.away;
  if (home == null || away == null) return null;
  return { homeGoals: home, awayGoals: away };
}

async function evaluateThesportsdb(doc) {
  const id = doc.id.replace(/^tsd-/, "");
  const data = await tsdGet(`/lookupevent.php?id=${id}`);
  const ev = (data.events || [])[0];
  if (!ev) return null;
  const home = ev.intHomeScore;
  const away = ev.intAwayScore;
  if (home == null || away == null) return null;
  return { homeGoals: Number(home), awayGoals: Number(away) };
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
}

async function run() {
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection("matches").get();
  const now = Date.now();
  const pending = [];
  snap.forEach((doc) => {
    const m = doc.data();
    if (m.evaluated === true) return;
    if (!m.match_date || m.match_date.toMillis() > now) return; // henüz oynanmadı
    pending.push({ id: doc.id, ref: doc.ref, data: m });
  });

  console.log(`${pending.length} maç değerlendirme bekliyor (bu çalıştırmada en fazla ${MAX_PER_RUN} işlenecek).`);

  const batch = db.batch();
  let evaluated = 0;
  let hits = 0;
  let skipped = 0;

  for (const item of pending.slice(0, MAX_PER_RUN)) {
    try {
      const score = item.id.startsWith("fd-")
        ? await evaluateFootballData(item)
        : await evaluateThesportsdb(item);

      if (!score) {
        skipped++;
        await sleep(item.id.startsWith("fd-") ? 6500 : 1500);
        continue;
      }

      const predicted = predictedResult(item.data);
      const actual = actualResult(score.homeGoals, score.awayGoals);
      const hit = predicted === actual;
      if (hit) hits++;

      batch.update(item.ref, {
        status: "finished",
        actual_home_goals: score.homeGoals,
        actual_away_goals: score.awayGoals,
        actual_result: actual,
        predicted_result: predicted,
        hit,
        evaluated: true,
        evaluated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      evaluated++;
      await sleep(item.id.startsWith("fd-") ? 6500 : 1500);
    } catch (err) {
      console.error(`${item.id} değerlendirilirken hata:`, err.message);
      skipped++;
    }
  }

  if (evaluated > 0) {
    await batch.commit();
  }
  console.log(`${evaluated} maç değerlendirildi (${hits} isabet), ${skipped} atlandı.`);
}

run().catch((err) => {
  console.error("Değerlendirme pipeline'ı hata verdi:", err);
  process.exit(1);
});

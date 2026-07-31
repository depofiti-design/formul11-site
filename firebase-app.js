import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, query, orderBy, limit, getDocs, getCountFromServer, addDoc, Timestamp
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

async function loadAnalizler() {
  const el = document.getElementById('analizList');
  if (!el) return;
  try {
    const matchesRef = collection(db, 'matches');
    const q = query(matchesRef, orderBy('match_date', 'asc'), limit(3));
    const snap = await getDocs(q);
    if (snap.empty) {
      el.innerHTML = '<div class="trow"><div>Henüz analiz eklenmedi, ilk otomatik güncelleme yakında çalışacak.</div></div>';
      return;
    }
    el.innerHTML = '';
    snap.forEach(function (doc) {
      const m = doc.data();
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML =
        '<div><div class="tag">' + m.competition_name + '</div>' + m.home_team + ' vs ' + m.away_team + '</div>' +
        '<span class="conf">%' + m.confidence + '</span>';
      el.appendChild(row);
    });
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

loadAnalizler();
loadMatchCount();
setupWaitlist();
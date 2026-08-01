import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

async function loadSocialIcons() {
  try {
    const snap = await getDoc(doc(db, "site_config", "main"));
    const social = snap.exists() ? (snap.data().social || {}) : {};
    document.querySelectorAll('#socialRow a[data-platform]').forEach(function (a) {
      const key = a.getAttribute('data-platform');
      const s = social[key];
      if (s && s.enabled && s.url) { a.href = s.url; a.style.display = 'flex'; }
      else { a.style.display = 'none'; }
    });
  } catch (err) {
    console.error('Sosyal ikonlar yüklenemedi:', err);
  }
}

loadSocialIcons();

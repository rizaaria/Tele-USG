import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// === Konfigurasi Firebase ===
const firebaseConfig = {
  apiKey: "AIzaSyDaytDfGyusxu-3waYR5U9vBFmfTEQTv4Q",
  authDomain: "teleusgchat.firebaseapp.com",
  databaseURL: "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "teleusgchat",
  storageBucket: "teleusgchat.appspot.com",
  messagingSenderId: "623391086693",
  appId: "1:623391086693:web:fbd62c11da5b6f80f6ce8c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// === Cek status login ===
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      // 🔍 Ambil data nama dari Realtime Database
      const snap = await get(ref(db, "users/" + user.uid));
      const data = snap.exists() ? snap.val() : null;
      const displayName = data?.name || user.displayName || "Pengguna";

      // 🧾 Tampilkan nama di dashboard
      document.getElementById("userName").textContent = displayName;
    } catch (err) {
      console.error("Gagal ambil data user:", err);
      document.getElementById("userName").textContent = "Pengguna";
    }
  } else {
    // jika belum login, arahkan ke halaman login
    location.href = "/login";
  }
});

// === Tombol logout ===
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  location.href = "/login";
});

// === Navigasi menu ===
window.goto = (page) => {
    if (page === "create") location.href = "/create";
    else if (page === "join") location.href = "/join";
    else if (page === 'patients') location.href = '/patients';
};

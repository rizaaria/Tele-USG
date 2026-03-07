import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// === Konfigurasi Firebase ===
const firebaseConfig = {
  apiKey: "AIzaSyDaytDfGyusxu-3waYR5U9vBFmfTEQTv4Q",
  authDomain: "teleusgchat.firebaseapp.com",
  databaseURL: "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "teleusgchat",
  storageBucket: "teleusgchat.appspot.com",
  messagingSenderId: "623391086693",
  appId: "1:623391086693:web:fbd62c11da5b6f80f6ce8c",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// 🚪 Logout otomatis setiap kali halaman login dibuka
(async () => {
  try {
    await signOut(auth);
  } catch {}
})();

// === Toggle Show/Hide Password ===
document.querySelectorAll(".pwd-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inputId = btn.getAttribute("data-target");
    const input = document.getElementById(inputId);
    const img = btn.querySelector("img");

    if (input.type === "password") {
      input.type = "text";
      img.src = "/static/img/Eye.png"; // 👁️ mata buka
    } else {
      input.type = "password";
      img.src = "/static/img/Eye off.png"; // 🚫 mata tutup
    }
  });
});

// === Proses Login ===
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const msg = document.getElementById("loginMsg");

  msg.textContent = "";
  msg.style.color = "#000";

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    // 🔍 Ambil nama dari Realtime Database
    const snap = await get(ref(db, "users/" + user.uid));
    const data = snap.exists() ? snap.val() : null;
    const displayName = data?.name || user.displayName || "Pengguna";

    msg.textContent = "Login Berhasil!";
    msg.style.color = "#34E334";

    // 🔀 Arahkan ke dashboard
    setTimeout(() => (location.href = "/dashboard"), 1000);
  } catch (err) {
    console.error(err);
    msg.textContent = `Email atau Password salah!`;
    msg.style.color = "#E33434";
  }
});

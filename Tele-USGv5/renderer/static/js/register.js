import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// === Konfigurasi Firebase ===
const firebaseConfig = {
  apiKey: "AIzaSyDaytDfGyusxu-3waYR5U9vBFmfTEQTv4Q",
  authDomain: "teleusgchat.firebaseapp.com",
  projectId: "teleusgchat",
  storageBucket: "teleusgchat.appspot.com",
  messagingSenderId: "623391086693",
  appId: "1:623391086693:web:fbd62c11da5b6f80f6ce8c",
  databaseURL: "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// 🧹 Pastikan tidak ada sesi login tersisa
signOut(auth).catch(() => {});

// === Toggle Show/Hide Password ===
document.querySelectorAll(".pwd-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inputId = btn.getAttribute("data-target");
    const input = document.getElementById(inputId);
    const img = btn.querySelector("img");

    if (input.type === "password") {
      input.type = "text";
      img.src = "/static/img/Eye.png";
    } else {
      input.type = "password";
      img.src = "/static/img/Eye off.png";
    }
  });
});

// === Proses registrasi ===
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const pass = document.getElementById("regPassword").value;
  const pass2 = document.getElementById("regPassword2").value;
  const msg = document.getElementById("registerMsg");

  msg.style.color = "#000";

  // 💬 Validasi dasar
  if (!name || !email || !pass || !pass2) {
    msg.textContent = "Semua kolom harus diisi!";
    msg.style.color = "#E33434";
    return;
  }
  if (pass !== pass2) {
    msg.textContent = "Password tidak sama!";
    msg.style.color = "#E33434";
    return;
  }
  if (pass.length < 6) {
    msg.textContent = "Password minimal 6 karakter.";
    msg.style.color = "#E33434";
    return;
  }

  try {
    // 🔐 Buat akun baru
    const cred = await createUserWithEmailAndPassword(auth, email, pass);

    // 🧾 Update profil Auth (displayName)
    await updateProfile(cred.user, { displayName: name });

    // 💾 Simpan ke Realtime Database
    const userRef = ref(db, "users/" + cred.user.uid);
    await set(userRef, {
      name: name,
      email: email,
      createdAt: new Date().toISOString()
    });

    msg.textContent = "Registrasi berhasil!";

    setTimeout(() => (location.href = "/login"), 1200);
  } catch (err) {
    console.error(err);
    msg.textContent = "Email sudah terdaftar!";
    msg.style.color = "#E33434";
  }
});

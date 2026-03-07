import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { showToast } from "./toast.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Logout on page load
(async () => {
    try { await signOut(auth); } catch { }
})();

// Toggle password visibility
document.querySelectorAll(".pwd-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
        const inputId = btn.getAttribute("data-target");
        const input = document.getElementById(inputId);
        const img = btn.querySelector("img");
        if (input.type === "password") {
            input.type = "text";
            img.src = "/static/img/Eye Visible.png";
        } else {
            input.type = "password";
            img.src = "/static/img/Eye Hidden.png";
        }
    });
});

// Login form
document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const msg = document.getElementById("loginMsg");

    msg.textContent = "";
    msg.style.color = "#000";

    if (!email || !password) {
        showToast("Masukkan email dan password!", "warning");
        return;
    }

    // Dev account bypass (for testing only)
    if ((email === "admin" && password === "admin") || (email === "admin2" && password === "admin2")) {
        sessionStorage.setItem("devMode", "true");
        showToast("Dev Login Berhasil!", "success");
        setTimeout(() => (location.href = "/dashboard"), 1000);
        return;
    }

    try {
        // Clear dev mode when logging with real account
        sessionStorage.removeItem("devMode");

        const cred = await signInWithEmailAndPassword(auth, email, password);
        const user = cred.user;

        const snap = await get(ref(db, "users/" + user.uid));
        const data = snap.exists() ? snap.val() : null;
        const displayName = data?.name || user.displayName || "Pengguna";

        showToast("Login Berhasil! Mengarahkan...", "success");

        setTimeout(() => (location.href = "/dashboard"), 1500);
    } catch (err) {
        console.error(err);
        const code = err.code || "";
        if (code === "auth/user-not-found" || code === "auth/invalid-email") {
            showToast("Email tidak terdaftar. Periksa kembali email Anda.", "error");
        } else if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
            showToast("Password salah. Silakan coba lagi.", "error");
        } else if (code === "auth/too-many-requests") {
            showToast("Terlalu banyak percobaan. Coba lagi nanti.", "warning");
        } else if (code === "auth/network-request-failed") {
            showToast("Tidak ada koneksi internet. Periksa jaringan Anda.", "error");
        } else {
            showToast("Login gagal. Periksa email dan password Anda.", "error");
        }
    }
});


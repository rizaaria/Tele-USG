import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { showToast } from "./toast.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

signOut(auth).catch(() => { });



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

// Register form
document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const pass = document.getElementById("regPassword").value;
    const pass2 = document.getElementById("regPassword2").value;
    const msg = document.getElementById("registerMsg");

    msg.style.color = "#000";

    if (!name || !email || !pass || !pass2) {
        showToast("Semua kolom harus diisi!", "error");
        return;
    }
    if (pass !== pass2) {
        showToast("Password tidak sama!", "error");
        return;
    }
    if (pass.length < 6) {
        showToast("Password minimal 6 karakter.", "error");
        return;
    }

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: name });

        const userRef = ref(db, "users/" + cred.user.uid);
        await set(userRef, {
            name: name,
            email: email,
            createdAt: new Date().toISOString()
        });

        showToast("Registrasi berhasil! Mengarahkan...", "success");

        setTimeout(() => (location.href = "/login"), 1500);
    } catch (err) {
        console.error(err);
        const code = err.code || "";
        if (code === "auth/email-already-in-use") {
            showToast("Email sudah terdaftar. Gunakan email lain.", "error");
        } else if (code === "auth/invalid-email") {
            showToast("Format email tidak valid.", "error");
        } else if (code === "auth/weak-password") {
            showToast("Password terlalu lemah. Gunakan minimal 6 karakter.", "warning");
        } else if (code === "auth/network-request-failed") {
            showToast("Tidak ada koneksi internet. Periksa jaringan Anda.", "error");
        } else {
            showToast("Registrasi gagal. Silakan coba lagi.", "error");
        }
    }
});

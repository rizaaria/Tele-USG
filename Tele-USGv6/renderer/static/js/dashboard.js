import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { initSessionTimeout } from "./session-timeout.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Initialize session timeout (30 min inactivity = auto logout)
initSessionTimeout(auth, signOut);

// Check auth state
onAuthStateChanged(auth, async (user) => {
    // Dev mode bypass
    if (sessionStorage.getItem("devMode") === "true") {
        document.getElementById("userName").textContent = "Admin (Dev)";
        return;
    }

    if (user) {
        try {
            const snap = await get(ref(db, "users/" + user.uid));
            const data = snap.exists() ? snap.val() : null;
            const displayName = data?.name || user.displayName || "Pengguna";
            document.getElementById("userName").textContent = displayName;
        } catch (err) {
            console.error("Gagal ambil data user:", err);
            document.getElementById("userName").textContent = "Pengguna";
        }
    } else {
        location.href = "/login";
    }
});

// Logout button
document.getElementById("logoutBtn").addEventListener("click", async () => {
    // Clear dev mode on logout
    sessionStorage.removeItem("devMode");
    await signOut(auth);
    location.href = "/login";
});

// Navigation
window.goto = (page) => {
    if (page === "create") location.href = "/create";
    else if (page === "join") location.href = "/join";
    else if (page === "patients") location.href = "/patients";
};

// Fetch and display ngrok URL
async function loadNgrokUrl() {
    try {
        const response = await fetch("/ngrok-url");
        const data = await response.json();
        if (data.url) {
            document.getElementById("ngrokSection").classList.remove("hidden");
            document.getElementById("ngrokUrl").textContent = data.url;
        }
    } catch (err) {
        console.log("Ngrok not available");
    }
}

// Toast notification system (same as login page)
function showToast(message, type = "success", duration = 3000) {
    const existing = document.querySelector(".toast-notification");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.innerHTML = `
        <div class="toast-icon">${type === "success" ? '<img src="/static/img/Succes.png" class="toast-img">' : type === "error" ? '<img src="/static/img/Error.png" class="toast-img">' : '<img src="/static/img/Loading.png" class="toast-img">'}</div>
        <div class="toast-message">${message}</div>
    `;

    const colors = {
        success: "linear-gradient(135deg, #2ecc71, #27ae60)",
        error: "linear-gradient(135deg, #e74c3c, #c0392b)",
        loading: "linear-gradient(135deg, #3498db, #2980b9)"
    };

    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type] || colors.success};
        color: white;
        padding: 12px 24px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 99999;
        animation: toast-slide-up 0.3s ease-out;
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-weight: 500;
    `;

    document.body.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            toast.style.animation = "toast-slide-down 0.3s ease-in forwards";
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    return toast;
}

// Add toast animation styles
const toastStyle = document.createElement("style");
toastStyle.textContent = `
    @keyframes toast-slide-up {
        from { transform: translateX(-50%) translateY(100px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    @keyframes toast-slide-down {
        from { transform: translateX(-50%) translateY(0); opacity: 1; }
        to { transform: translateX(-50%) translateY(100px); opacity: 0; }
    }
`;
document.head.appendChild(toastStyle);

// Copy ngrok URL to clipboard
document.getElementById("copyNgrokBtn")?.addEventListener("click", () => {
    const url = document.getElementById("ngrokUrl").textContent;
    if (url && url !== "Loading...") {
        navigator.clipboard.writeText(url).then(() => {
            showToast("URL disalin ke clipboard!", "success");
        }).catch(() => {
            showToast("Gagal menyalin URL!", "error");
        });
    }
});

// Load ngrok URL on page load
loadNgrokUrl();

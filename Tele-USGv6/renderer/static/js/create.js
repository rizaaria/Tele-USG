import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { showToast } from "./toast.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Auth check
onAuthStateChanged(auth, (user) => {
    // Dev mode bypass
    if (sessionStorage.getItem("devMode") === "true") {
        const userName = document.getElementById("userName");
        if (userName) userName.textContent = "Admin (Dev)";
        return;
    }

    if (!user) location.href = "/login";
    else {
        const userName = document.getElementById("userName");
        if (userName) userName.textContent = user.displayName || "User";
    }
});

// DOM
const video = document.getElementById("cameraPreview");
const placeholder = document.getElementById("cameraPlaceholder");
const cameraSelect = document.getElementById("cameraSelect");
const micBtn = document.getElementById("toggleMic");
const camBtn = document.getElementById("toggleCam");
const micIcon = micBtn.querySelector("img");
const camIcon = camBtn.querySelector("img");
const camOffIcon = document.getElementById("camOffIcon");
const micOffIcon = document.getElementById("micOffIcon");
const createBtn = document.getElementById("createBtn");
const backBtn = document.getElementById("backBtn");
const logoutBtn = document.getElementById("logoutBtn");
const copyBtn = document.getElementById("copyBtn");
const roomInput = document.getElementById("roomId");
const createMsg = document.getElementById("createMsg");



// State
let currentStream = null;
let selectedCam = null;
let selectedMic = null;
let micOn = true;
let camOn = true;

// Popup elements
const micSelect = document.getElementById("micSelect");
const micArrow = document.getElementById("micArrow");
const micPopup = document.getElementById("micPopup");
const camArrow = document.getElementById("camArrow");
const camPopup = document.getElementById("camPopup");

// Popup handlers
micArrow?.addEventListener("click", (e) => {
    e.stopPropagation();
    micPopup?.classList.toggle("hidden");
    camPopup?.classList.add("hidden");
});
camArrow?.addEventListener("click", (e) => {
    e.stopPropagation();
    camPopup?.classList.toggle("hidden");
    micPopup?.classList.add("hidden");
});
document.addEventListener("click", () => {
    micPopup?.classList.add("hidden");
    camPopup?.classList.add("hidden");
});
micPopup?.addEventListener("click", (e) => e.stopPropagation());
camPopup?.addEventListener("click", (e) => e.stopPropagation());

// Mic selection handler
micSelect?.addEventListener("change", async (e) => {
    selectedMic = e.target.value;
    sessionStorage.setItem("selectedMicrophone", selectedMic);
    // Restart media with new mic
    if (camOn && selectedCam) await startCamera(selectedCam);
});

function stopCurrentStream() {
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
    }
}

function setCamOffUI(isError = false) {
    stopCurrentStream();
    video.srcObject = null;
    video.style.display = "none";
    placeholder.style.display = "flex";
    if (isError) {
        placeholder.textContent = "Tidak dapat mengakses kamera";
        camOffIcon.style.display = "none";
    } else {
        placeholder.textContent = "";
        camOffIcon.style.display = "block";
    }
}

async function startCamera(deviceId) {
    try {
        stopCurrentStream();
        if (!camOn) { setCamOffUI(); return; }

        // Build video constraints with ideal resolution for 16:9 aspect ratio
        const videoConstraints = {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 }
        };
        if (deviceId) videoConstraints.deviceId = { exact: deviceId };

        const constraints = {
            video: videoConstraints,
            audio: true
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;
        currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
        currentStream.getVideoTracks().forEach(t => (t.enabled = camOn));

        video.srcObject = currentStream;
        video.muted = true;
        video.style.display = camOn ? "block" : "none";
        placeholder.style.display = camOn ? "none" : "flex";
        camOffIcon.style.display = "none";

        selectedCam = deviceId || (currentStream.getVideoTracks()[0]?.label ?? null);
        sessionStorage.setItem("selectedCamera", deviceId || "");
    } catch (err) {
        console.error("Tidak dapat mengakses kamera:", err);
        setCamOffUI(true);
        if (err.name === "NotAllowedError") {
            showToast("Akses kamera ditolak. Izinkan di pengaturan browser.", "error");
        } else if (err.name === "NotFoundError") {
            showToast("Kamera tidak ditemukan. Periksa koneksi perangkat.", "error");
        } else if (err.name === "NotReadableError") {
            showToast("Kamera sedang digunakan aplikasi lain.", "warning");
        } else {
            showToast("Gagal membuka kamera. Pastikan perangkat tersedia.", "error");
        }
    }
}

async function loadCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === "videoinput");
        const mics = devices.filter(d => d.kind === "audioinput");

        // Populate cameras
        cameraSelect.innerHTML = "";
        cameras.forEach((cam, idx) => {
            const opt = document.createElement("option");
            opt.value = cam.deviceId;
            opt.textContent = cam.label || `Kamera ${idx}`;
            cameraSelect.appendChild(opt);
        });

        // Populate mics
        if (micSelect) {
            micSelect.innerHTML = "";
            mics.forEach((mic, idx) => {
                const opt = document.createElement("option");
                opt.value = mic.deviceId;
                opt.textContent = mic.label || `Mikrofon ${idx}`;
                micSelect.appendChild(opt);
            });
            const savedMic = sessionStorage.getItem("selectedMicrophone");
            if (savedMic) {
                micSelect.value = savedMic;
                selectedMic = savedMic;
            }
        }

        const saved = sessionStorage.getItem("selectedCamera");
        if (saved && cameras.some(c => c.deviceId === saved)) {
            selectedCam = saved;
        } else {
            selectedCam = cameras[0]?.deviceId || null;
        }

        if (selectedCam) cameraSelect.value = selectedCam;
        if (camOn && selectedCam) await startCamera(selectedCam);
        else setCamOffUI();
    } catch (err) {
        console.error("Gagal enumerateDevices:", err);
        setCamOffUI(true);
        showToast("Gagal mendeteksi perangkat. Periksa izin browser.", "error");
    }
}

cameraSelect.addEventListener("change", async (e) => {
    selectedCam = e.target.value || null;
    sessionStorage.setItem("selectedCamera", selectedCam || "");
    if (camOn && selectedCam) await startCamera(selectedCam);
});

micBtn.addEventListener("click", () => {
    micOn = !micOn;
    if (currentStream) currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
    micIcon.src = micOn ? "/static/img/On Mic.png" : "/static/img/Off Mic.png";
    micOffIcon.style.display = micOn ? "none" : "block";
});

camBtn.addEventListener("click", async () => {
    camOn = !camOn;
    if (!camOn) {
        setCamOffUI();
        camIcon.src = "/static/img/Off Cam.png";
        return;
    }
    camOffIcon.style.display = "none";
    camIcon.src = "/static/img/On Cam.png";
    placeholder.style.display = "none";
    await startCamera(selectedCam);
});

async function generateUniqueRoomId() {
    const dbRef = ref(db);
    let unique = false;
    let roomId = "";

    while (!unique) {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
        const snapshot = await get(child(dbRef, `meetings/${roomId}`));
        if (!snapshot.exists()) unique = true;
    }

    if (roomInput) roomInput.value = roomId;
    return roomId;
}

createBtn.addEventListener("click", async () => {
    const isDevMode = sessionStorage.getItem("devMode") === "true";
    const user = auth.currentUser;

    if (!user && !isDevMode) {
        showToast("Silakan login terlebih dahulu!", "warning");
        return;
    }

    let roomID = (roomInput.value || "").trim();
    if (!roomID) roomID = await generateUniqueRoomId();

    sessionStorage.setItem("selectedCamera", selectedCam || "");
    sessionStorage.setItem("micState", String(micOn));
    sessionStorage.setItem("camState", String(camOn));

    const userId = isDevMode ? "dev" : user.uid;
    const userEmail = isDevMode ? "admin@dev" : user.email;

    // Create room with participant
    await set(ref(db, `rooms/${roomID}`), {
        host: userEmail,
        createdAt: Date.now(),
        status: "active"
    });

    // Add participant to room
    await set(ref(db, `rooms/${roomID}/participants/${userId}`), {
        email: userEmail,
        joinedAt: Date.now()
    });

    window.location.href = `/meeting/${roomID}`;
});

copyBtn.addEventListener("click", () => {
    const id = roomInput.value.trim();
    if (!id) {
        showToast("Room ID kosong!", "error");
        return;
    }
    navigator.clipboard.writeText(id).then(() => {
        showToast("Room ID disalin ke clipboard!", "success");
    }).catch((err) => {
        console.error("Clipboard error:", err);
        showToast("Gagal menyalin Room ID!", "error");
    });
});

backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    location.href = "/dashboard";
});

logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
        await signOut(auth);
        location.href = "/login";
    } catch (err) {
        console.error("Logout failed:", err);
        showToast("Gagal logout. Silakan coba lagi.", "error");
    }
});

(async function init() {
    await generateUniqueRoomId();
    await loadCameras();
})();

window.addEventListener("beforeunload", () => {
    try { stopCurrentStream(); } catch { }
});

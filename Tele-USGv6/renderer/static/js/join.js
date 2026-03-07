import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, child, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { showToast } from "./toast.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

onAuthStateChanged(auth, (user) => {
    // Dev mode bypass
    if (sessionStorage.getItem("devMode") === "true") {
        document.getElementById("userName").textContent = "Admin (Dev)";
        return;
    }

    if (!user) location.href = "/login";
    else document.getElementById("userName").textContent = user.displayName || "User";
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
const joinBtn = document.getElementById("joinBtn");
const backBtn = document.getElementById("backBtn");
const logoutBtn = document.getElementById("logoutBtn");
const pasteBtn = document.getElementById("pasteBtn");
const joinMsg = document.getElementById("joinMsg");
const roomInput = document.getElementById("roomId");

roomInput.addEventListener("input", () => {
    roomInput.value = sanitizeRoomId(roomInput.value);
});

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

        selectedCam = deviceId || "";
        sessionStorage.setItem("selectedCamera", selectedCam);
    } catch (err) {
        console.error("Camera error:", err);
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

function sanitizeRoomId(value) {
    let digits = (value || "").replace(/\D/g, "");
    return digits.slice(0, 6);
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
        if (camOn && selectedCam) startCamera(selectedCam);
        else setCamOffUI();
    } catch (err) {
        console.error("enumerateDevices() error:", err);
        setCamOffUI(true);
        showToast("Gagal mendeteksi perangkat. Periksa izin browser.", "error");
    }
}

cameraSelect.addEventListener("change", (e) => {
    selectedCam = e.target.value;
    sessionStorage.setItem("selectedCamera", selectedCam);
    if (camOn) startCamera(selectedCam);
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

joinBtn.addEventListener("click", async () => {
    const roomId = roomInput.value.trim();
    const isDevMode = sessionStorage.getItem("devMode") === "true";
    const user = auth.currentUser;

    if (!roomId) {
        joinMsg.textContent = "Masukkan Room ID.";
        joinMsg.style.color = "#E33434";
        showToast("Masukkan Room ID terlebih dahulu.", "warning");
        return;
    }

    const dbRef = ref(db);
    const snapshot = await get(child(dbRef, `rooms/${roomId}`));

    if (!snapshot.exists()) {
        joinMsg.textContent = "Room tidak tersedia.";
        joinMsg.style.color = "#E33434";
        showToast("Room ID tidak ditemukan. Periksa kembali.", "error");
        return;
    }

    // Check participants from rooms/{roomId}/participants
    const participantsSnap = await get(child(dbRef, `rooms/${roomId}/participants`));
    const participants = participantsSnap.exists() ? Object.keys(participantsSnap.val()) : [];
    const currentUserId = isDevMode ? 'dev' : user?.uid;
    const isAlreadyParticipant = currentUserId && participants.includes(currentUserId);

    // Reject if room is empty (no active participants)
    if (participants.length === 0) {
        joinMsg.textContent = "Room sudah tidak aktif.";
        joinMsg.style.color = "#E33434";
        return;
    }

    if (participants.length >= 2 && !isAlreadyParticipant) {
        joinMsg.textContent = "Room sudah penuh.";
        joinMsg.style.color = "#E33434";
        showToast("Room sudah penuh (maksimal 2 peserta).", "warning");
        return;
    }

    sessionStorage.setItem("selectedCamera", selectedCam || "");
    sessionStorage.setItem("micState", micOn);
    sessionStorage.setItem("camState", camOn);

    const userId = isDevMode ? "dev" : user.uid;
    const userEmail = isDevMode ? "admin@dev" : user.email;

    // Add participant to room
    await set(ref(db, `rooms/${roomId}/participants/${userId}`), {
        email: userEmail,
        joinedAt: Date.now()
    });

    location.href = `/meeting/${roomId}`;
});

backBtn.addEventListener("click", () => location.href = "/dashboard");

logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        location.href = "/login";
    } catch (err) {
        console.error("Logout gagal:", err);
        showToast("Gagal logout. Silakan coba lagi.", "error");
    }
});



pasteBtn.addEventListener("click", async () => {
    try {
        const text = await navigator.clipboard.readText();
        const cleaned = sanitizeRoomId(text);
        roomInput.value = cleaned;
        if (cleaned) {
            showToast("Room ID ditempel!", "success");
        } else {
            showToast("Clipboard tidak valid!", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Gagal membaca clipboard!", "error");
    }
});

(async function init() {
    await loadCameras();
})();

window.addEventListener("beforeunload", () => {
    try { stopCurrentStream(); } catch { }
});

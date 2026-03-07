// ======================================================
// JOIN.JS FINAL VERSION — FIXED CAMERA & MIC TOGGLE
// ======================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, child, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ------------------------------------------------------
// FIREBASE CONFIG
// ------------------------------------------------------
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

// ------------------------------------------------------
// AUTH CHECK
// ------------------------------------------------------
onAuthStateChanged(auth, (user) => {
  if (!user) location.href = "/login";
  else document.getElementById("userName").textContent = user.displayName || "User";
});

// ------------------------------------------------------
// DOM ELEMENTS
// ------------------------------------------------------
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

// ======================================================
// LIMIT INPUT ROOM ID: ONLY NUMBERS, MAX 6 DIGITS
// ======================================================
roomInput.addEventListener("input", () => {
  roomInput.value = sanitizeRoomId(roomInput.value);
});

// ------------------------------------------------------
// STATE
// ------------------------------------------------------
let currentStream = null;
let camsList = [];
let selectedCam = null;

let micOn = true;
let camOn = true;

// ------------------------------------------------------
// STOP STREAM UTILS
// ------------------------------------------------------
function stopCurrentStream() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

// ------------------------------------------------------
// SET CAMERA OFF UI
// ------------------------------------------------------
function setCamOffUI(isError = false) {
  stopCurrentStream();

  video.srcObject = null;
  video.style.display = "none";

  placeholder.style.display = "flex";

  if (isError) {
    placeholder.textContent = "Tidak dapat mengakses kamera";
    camOffIcon.style.display = "none";   // FIX: icon kamera off disembunyikan
  } else {
    placeholder.textContent = "";        // user mematikan kamera → kosong
    camOffIcon.style.display = "block";  // icon kamera off hanya untuk kamera OFF (bukan error)
  }
}

// ------------------------------------------------------
// START CAMERA — SAME LOGIC AS CREATE.JS
// ------------------------------------------------------
async function startCamera(deviceId) {
  try {
    stopCurrentStream();

    if (!camOn) {
      setCamOffUI();
      return;
    }

    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
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
  }
}

// === Sanitizer Room ID: hanya angka, max 6 ===
function sanitizeRoomId(value) {
  let digits = (value || "").replace(/\D/g, "");
  return digits.slice(0, 6);
}

// ------------------------------------------------------
// LOAD AVAILABLE CAMERAS
// ------------------------------------------------------
async function loadCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === "videoinput");

    camsList = cameras;
    cameraSelect.innerHTML = "";

    cameras.forEach((cam, idx) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Kamera ${idx}`;
      cameraSelect.appendChild(opt);
    });

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
  }
}

cameraSelect.addEventListener("change", (e) => {
  selectedCam = e.target.value;
  sessionStorage.setItem("selectedCamera", selectedCam);
  if (camOn) startCamera(selectedCam);
});

// ------------------------------------------------------
// MIC TOGGLE
// ------------------------------------------------------
micBtn.addEventListener("click", () => {
  micOn = !micOn;

  if (currentStream) {
    currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  }

  micIcon.src = micOn ? "/static/img/Mic.png" : "/static/img/Mic off.png";
  micOffIcon.style.display = micOn ? "none" : "block";
});

// ------------------------------------------------------
// CAMERA TOGGLE — EXACTLY LIKE CREATE.JS
// ------------------------------------------------------
camBtn.addEventListener("click", async () => {
  camOn = !camOn;

  if (!camOn) {
    setCamOffUI();
    camIcon.src = "/static/img/Camera off.png";
    return;
  }

  camOffIcon.style.display = "none";
  camIcon.src = "/static/img/Icon.png";
  placeholder.style.display = "none";

  await startCamera(selectedCam);
});

// ------------------------------------------------------
// JOIN ROOM
// ------------------------------------------------------
joinBtn.addEventListener("click", async () => {
  const roomId = roomInput.value.trim();
  const user = auth.currentUser;

  if (!roomId) {
    joinMsg.textContent = "Masukkan Room ID.";
    joinMsg.style.color = "#E33434";
    return;
  }

  const dbRef = ref(db);
  const snapshot = await get(child(dbRef, `meetings/${roomId}`));

  if (!snapshot.exists()) {
    joinMsg.textContent = "Room tidak tersedia.";
    joinMsg.style.color = "#E33434";
    return;
  }

  const data = snapshot.val();
  const participants = data.participants ? Object.keys(data.participants) : [];

  if (participants.length >= 2) {
    joinMsg.textContent = "Room sudah penuh.";
    joinMsg.style.color = "#E33434";
    return;
  }

  sessionStorage.setItem("selectedCamera", selectedCam || "");
  sessionStorage.setItem("micState", micOn);
  sessionStorage.setItem("camState", camOn);

  await update(ref(db), {
    [`meetings/${roomId}/participants/${user.uid}`]: user.email
  });

  location.href = `/meeting/${roomId}`;
});

// ------------------------------------------------------
// BACK + LOGOUT
// ------------------------------------------------------
backBtn.addEventListener("click", () => {
  location.href = "/dashboard";
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    location.href = "/login";
  } catch (err) {
    console.error("Logout gagal:", err);
  }
});

// ------------------------------------------------------
// PASTE ROOM ID
// ------------------------------------------------------
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    const cleaned = sanitizeRoomId(text);

    roomInput.value = cleaned;               // hanya angka, max 6
    joinMsg.textContent = cleaned ? "Room ID ditempel." : "Clipboard tidak valid.";
    joinMsg.style.color = cleaned ? "#34E334" : "#E33434";

  } catch (err) {
    console.error(err);
  }
});

// ------------------------------------------------------
// INIT
// ------------------------------------------------------
(async function init() {
  await loadCameras();
})();

// ------------------------------------------------------
// STOP CAMERA SAAT PINDAH HALAMAN
// ------------------------------------------------------
window.addEventListener("beforeunload", () => {
  try {
    stopCurrentStream();
  } catch {}
});

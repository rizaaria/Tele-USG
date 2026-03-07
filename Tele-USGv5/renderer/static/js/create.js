import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// === Firebase Config ===
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

// ===============================
// AUTH
// ===============================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.href = "/login";
  } else {
    const userName = document.getElementById("userName");
    if (userName) userName.textContent = user.displayName || "User";
  }
});

// ===============================
// DOM
// ===============================
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

// ===============================
// STATE
// ===============================
let currentStream = null;
let camsList = [];
let selectedCam = null;

// default mic/cam ON di halaman create
let micOn = true;
let camOn = true;

// ===============================
// CAMERA UTILS
// ===============================
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
    camOffIcon.style.display = "none";   // FIX utama
  } else {
    placeholder.textContent = "";
    camOffIcon.style.display = "block";
  }
}

async function startCamera(deviceId) {
  try {
    // matikan stream lama dulu
    stopCurrentStream();

    // kalau logika kamera OFF → jangan buka kamera
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

    // atur track sesuai state mic/cam
    currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
    currentStream.getVideoTracks().forEach(t => (t.enabled = camOn));

    // tampilkan preview
    video.srcObject = currentStream;
    video.muted = true;
    video.style.display = camOn ? "block" : "none";
    placeholder.style.display = camOn ? "none" : "flex";

    // simpan camera yang berhasil dipakai
    selectedCam = deviceId || (currentStream.getVideoTracks()[0]?.label ?? null);
    sessionStorage.setItem("selectedCamera", deviceId || "");

  } catch (err) {
    console.error("Tidak dapat mengakses kamera:", err);
    setCamOffUI(true);
  }
}

// ===============================
// LOAD CAMERA DEVICES
// ===============================
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

    // coba baca kamera terakhir yang dipakai (kalau ada)
    const saved = sessionStorage.getItem("selectedCamera");

    if (saved && cameras.some(c => c.deviceId === saved)) {
      selectedCam = saved;
    } else {
      selectedCam = cameras[0]?.deviceId || null;
    }

    if (selectedCam) {
      cameraSelect.value = selectedCam;
    }

    if (camOn && selectedCam) {
      await startCamera(selectedCam);
    } else {
      setCamOffUI();
    }
  } catch (err) {
    console.error("Gagal enumerateDevices:", err);
    setCamOffUI(true);
  }
}

// ganti kamera manual
cameraSelect.addEventListener("change", async (e) => {
  selectedCam = e.target.value || null;
  sessionStorage.setItem("selectedCamera", selectedCam || "");
  if (camOn && selectedCam) {
    await startCamera(selectedCam);
  }
});

// ===============================
// TOGGLE MIC & CAM
// ===============================
micBtn.addEventListener("click", () => {
  micOn = !micOn;

  if (currentStream) {
    currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  }

  micIcon.src = micOn ? "/static/img/Mic.png" : "/static/img/Mic off.png";

  micOffIcon.style.display = micOn ? "none" : "block";
});

camBtn.addEventListener("click", async () => {
  camOn = !camOn;

  if (!camOn) {
    // benar-benar matikan kamera
    setCamOffUI();
    camIcon.src = "/static/img/Camera off.png";
    return;
  } 
  camOffIcon.style.display = "none";
  camIcon.src = "/static/img/Icon.png";
  placeholder.style.display = "none";

  await startCamera(selectedCam);
});

// ===============================
// AUTO ROOM GENERATOR
// ===============================
async function generateUniqueRoomId() {
  const dbRef = ref(db);
  let unique = false;
  let roomId = "";

  while (!unique) {
    roomId = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
    const snapshot = await get(child(dbRef, `meetings/${roomId}`));
    if (!snapshot.exists()) unique = true;
  }

  if (roomInput) roomInput.value = roomId;
  return roomId;
}

// ===============================
// CREATE MEETING
// ===============================
createBtn.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) {
    alert("Silakan login terlebih dahulu!");
    return;
  }

  let roomID = (roomInput.value || "").trim();
  if (!roomID) {
    roomID = await generateUniqueRoomId();
  }

  // simpan state ke sessionStorage untuk meeting.js
  sessionStorage.setItem("selectedCamera", selectedCam || "");
  sessionStorage.setItem("micState", String(micOn));
  sessionStorage.setItem("camState", String(camOn));

  await set(ref(db, "meetings/" + roomID), {
    host: user.email,
    timestamp: Date.now(),
    participants: {
      [user.uid]: user.email
    },
    status: "active"
  });

  window.location.href = `/meeting/${roomID}`;
});

// ===============================
// COPY ROOM ID
// ===============================
copyBtn.addEventListener("click", () => {
  const id = roomInput.value.trim();
  if (!id) {
    createMsg.textContent = "Room ID kosong.";
    createMsg.style.color = "#E33434";
    return;
  }

  navigator.clipboard.writeText(id)
    .then(() => {
      createMsg.textContent = "Room ID disalin ke clipboard.";
      createMsg.style.color = "#34E334";
      setTimeout(() => (createMsg.textContent = ""), 2000);
    })
    .catch((err) => {
      console.error("Clipboard error:", err);
      createMsg.textContent = "Gagal menyalin Room ID.";
      createMsg.style.color = "#E33434";
    });
});

// ===============================
// BACK & LOGOUT
// ===============================
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
  }
});

// ===============================
// INIT
// ===============================
(async function init() {
  // generate room id dari awal
  await generateUniqueRoomId();
  await loadCameras();
})();

// ===============================
// STOP CAMERA SAAT PINDAH HALAMAN
// ===============================
window.addEventListener("beforeunload", () => {
  try {
    stopCurrentStream();
  } catch {}
});

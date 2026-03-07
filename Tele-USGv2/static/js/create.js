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

// === AUTH ===
onAuthStateChanged(auth, (user) => {
  if (user) document.getElementById("userName").textContent = user.displayName || "User";
  else location.href = "/login";
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  location.href = "/login";
});

// === CAMERA PREVIEW ===
const video = document.getElementById("cameraPreview");
const placeholder = document.getElementById("cameraPlaceholder");
const cameraSelect = document.getElementById("cameraSelect");
const micBtn = document.getElementById("toggleMic");
const camBtn = document.getElementById("toggleCam");
const micIcon = micBtn.querySelector("img");
const camIcon = camBtn.querySelector("img");

let currentStream = null;
let micOn = true;
let camOn = true;

async function loadCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === "videoinput");
  cameraSelect.innerHTML = "";
  cameras.forEach((cam, idx) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Kamera ${idx}`;
    cameraSelect.appendChild(opt);
  });
  if (cameras.length > 0) startCamera(cameras[0].deviceId);
}

async function startCamera(deviceId) {
  try {
    const constraints = {
      video: { deviceId: deviceId ? { exact: deviceId } : undefined },
      audio: true
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getAudioTracks().forEach(track => (track.enabled = micOn));
    stream.getVideoTracks().forEach(track => (track.enabled = camOn));

    video.srcObject = stream;
    video.muted = true;
    video.style.display = camOn ? "block" : "none";
    placeholder.style.display = camOn ? "none" : "flex";
    currentStream = stream;
  } catch (err) {
    console.error("Tidak bisa akses kamera:", err);
    placeholder.textContent = "Tidak dapat mengakses kamera";
  }
}

micBtn.addEventListener("click", () => {
  if (!currentStream) return;
  micOn = !micOn;
  currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  micIcon.src = micOn ? "/static/img/Mic.png" : "/static/img/Mic off.png";
});

camBtn.addEventListener("click", async () => {
  camOn = !camOn;
  if (!camOn) {
    currentStream?.getVideoTracks().forEach(track => track.stop());
    video.srcObject = null;
    camIcon.src = "/static/img/Camera off.png";
    video.style.display = "none";
    placeholder.style.display = "flex";
  } else {
    await startCamera(cameraSelect.value || undefined);
    camIcon.src = "/static/img/Icon.png";
  }
});

cameraSelect.addEventListener("change", async (e) => {
  await startCamera(e.target.value);
});

// === AUTO ROOM GENERATOR ===
async function generateUniqueRoomId() {
  const dbRef = ref(db);
  let unique = false;
  let roomId = "";

  while (!unique) {
    roomId = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit random
    const snapshot = await get(child(dbRef, `meetings/${roomId}`));
    if (!snapshot.exists()) unique = true;
  }

  document.getElementById("roomId").value = roomId;
  return roomId;
}

// === COPY ROOM ID ===
document.getElementById("copyBtn").addEventListener("click", () => {
  const roomId = document.getElementById("roomId").value;
  navigator.clipboard.writeText(roomId);
  const msg = document.getElementById("createMsg");
  msg.textContent = "Room ID disalin ke clipboard.";
  msg.style.color = "#34E334";
  setTimeout(() => (msg.textContent = ""), 2000);
});

// === CREATE MEETING ===
document.getElementById("createBtn").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return alert("Silakan login terlebih dahulu!");

  // ambil atau buat room ID baru
  const roomID = document.getElementById("roomId").value.trim() || await generateUniqueRoomId();

  // 🔹 simpan ke Firebase dengan struktur lengkap (termasuk participants)
  await set(ref(db, "meetings/" + roomID), {
    host: user.email,
    timestamp: Date.now(),
    participants: {
      [user.uid]: user.email   // host otomatis terdaftar
    },
    status: "active"
  });

  // langsung redirect ke meeting page
  window.location.href = `/meeting/${roomID}`;
});


// === BACK ===
document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "/dashboard";
});

// === INIT ===
await generateUniqueRoomId();
loadCameras();

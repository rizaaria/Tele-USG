import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, child, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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

// === CAMERA PREVIEW (sama seperti sebelumnya) ===
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
    if (currentStream) currentStream.getVideoTracks().forEach(track => track.stop());
    video.srcObject = null;
    camIcon.src = "/static/img/Camera off.png";
    video.style.display = "none";
    placeholder.style.display = "flex";
  } else {
    const deviceId = cameraSelect.value || undefined;
    const newVideoStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId ? { exact: deviceId } : undefined }
    });
    if (currentStream) {
      const audioTracks = currentStream.getAudioTracks();
      currentStream = new MediaStream([...audioTracks, ...newVideoStream.getVideoTracks()]);
    } else {
      currentStream = newVideoStream;
    }
    video.srcObject = currentStream;
    video.muted = true;
    camIcon.src = "/static/img/Icon.png";
    video.style.display = "block";
    placeholder.style.display = "none";
  }
});

cameraSelect.addEventListener("change", async (e) => {
  const selectedId = e.target.value;
  await startCamera(selectedId);
  currentStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  if (!camOn) {
    currentStream.getVideoTracks().forEach(track => track.stop());
    video.srcObject = null;
    video.style.display = "none";
    placeholder.style.display = "flex";
  }
});

loadCameras();

// === JOIN ROOM ===
const joinMsg = document.getElementById("joinMsg");
document.getElementById("joinBtn").addEventListener("click", async () => {
  const user = auth.currentUser;
  const roomId = document.getElementById("roomId").value.trim();

  if (!roomId) {
    joinMsg.textContent = "Masukkan Room ID terlebih dahulu.";
    joinMsg.style.color = "#E33434";
    return;
  }

  try {
    const dbRef = ref(db);
    const snapshot = await get(child(dbRef, `meetings/${roomId}`));

    if (!snapshot.exists()) {
      joinMsg.textContent = "Room tidak tersedia.";
      joinMsg.style.color = "#E33434";
      return;
    }

    const data = snapshot.val();
    const participants = data.participants ? Object.keys(data.participants) : [];

    // 🔹 batasi maksimal 2 peserta
    if (participants.length >= 2) {
      joinMsg.textContent = "Room sudah penuh. Maksimal 2 peserta.";
      joinMsg.style.color = "#E33434";
      return;
    }

    // ✅ tambahkan user ke participants
    const updates = {};
    updates[`meetings/${roomId}/participants/${user.uid}`] = user.email;
    await update(ref(db), updates);

    joinMsg.textContent = "Room ditemukan! Menghubungkan...";
    joinMsg.style.color = "#34E334";
    setTimeout(() => (location.href = `/meeting/${roomId}`), 1000);
  } catch (err) {
    console.error(err);
    joinMsg.textContent = "Gagal memeriksa room.";
    joinMsg.style.color = "#E33434";
  }
});

document.getElementById("backBtn").addEventListener("click", () => {
  location.href = "/dashboard";
});

// === PASTE ROOM ID ===
const pasteBtn = document.getElementById("pasteBtn");
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      document.getElementById("roomId").value = text.trim();
      joinMsg.textContent = "Room ID ditempel dari clipboard.";
      joinMsg.style.color = "#34E334";
      setTimeout(() => (joinMsg.textContent = ""), 2000);
    } else {
      joinMsg.textContent = "Clipboard kosong.";
      joinMsg.style.color = "#E33434";
    }
  } catch (err) {
    console.error("Gagal menempel:", err);
    joinMsg.textContent = "Tidak dapat mengakses clipboard.";
    joinMsg.style.color = "#E33434";
  }
});

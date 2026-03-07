// =====================================================
// MEETING.JS — FULL: CAMERA + MIC + CHAT + NOTES + USG (2nd VIDEO TRACK)
// MODE B: USG as second WebRTC video track (PiP / camera2)
// =====================================================

// ---------- Firebase (ESM) ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  onChildAdded,
  query,
  orderByChild,
  off,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ---------- Firebase config ----------
const firebaseConfig = {
  apiKey: "AIzaSyDaytDfGyusxu-3waYR5U9vBFmfTEQTv4Q",
  authDomain: "teleusgchat.firebaseapp.com",
  databaseURL: "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "teleusgchat",
  storageBucket: "teleusgchat.appspot.com",
  messagingSenderId: "623391086693",
  appId: "1:623391086693:web:fbd62c11da5b6b80f6ce8c"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getDatabase(fbApp);

// ---------- Room ID ----------
const roomID = window.location.pathname.split("/").pop();
const roomInfo = document.getElementById("roomInfo");
if (roomInfo) roomInfo.textContent = "Room ID: " + roomID;

// ---------- CHAT DOM ----------
const chatMessages = document.getElementById("chatMessages");
const chatText = document.getElementById("chatText");
const chatSend = document.getElementById("chatSend");
const chatHeader = document.getElementById("chatHeader");

let nickname = "User";
const chatRef = ref(db, `chats/${roomID}`);
let chatListenerAttached = false;

// ================= USG GLOBAL STATE =================
let usgActive = false;        // apakah ADA yang share (global room)
let usgOwnerId = null;        // siapa yang share
const usgStateRef = ref(db, `rooms/${roomID}/usg`);

// =====================================================
// USG SHARE (STATE)
// =====================================================
let usgWS = null;                // websocket preview / stream (Python OpenCV)
let usgSharing = false;          // share ON/OFF
let usgCanvas = null;
let usgCtx = null;
let usgStream = null;            // canvas.captureStream()
let usgFrameTimer = null;        // watchdog kalau tidak ada frame

// WebRTC sender khusus USG (VIDEO TRACK ke-2)
let usgSender = null;            // RTCRtpSender untuk USG video track (track kedua)

// remote streams
let remoteStreamLatest = null;      // remote stream (kamera utama lawan) dari ontrack
let remoteUsgStreamLatest = null;   // remote stream (USG track lawan), kita bikin sendiri dari track

function isShareLayout() {
  // share-mode aktif kalau:
  // - saya sedang share (usgSharing)
  // - atau lawan sedang share (usgActive) dan owner != saya
  return Boolean(usgSharing || (usgActive && usgOwnerId && usgOwnerId !== myId));
}

// ambil nickname dari auth
onAuthStateChanged(auth, (user) => {
  if (user) {
    nickname =
      user.displayName ||
      (user.email ? user.email.split("@")[0] : "User");
  }
});

// helper untuk menampilkan pesan di box chat
function appendChatMessage(name, message, isSelf) {
  if (!chatMessages) return;

  const wrapper = document.createElement("div");
  wrapper.classList.add("chat-message");

  if (isSelf) {
    wrapper.classList.add("chat-self");
  } else {
    wrapper.classList.add("chat-other");

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("chat-name");
    nameDiv.textContent = name;
    wrapper.appendChild(nameDiv);
  }

  const msgDiv = document.createElement("div");
  msgDiv.textContent = message;

  wrapper.appendChild(msgDiv);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// kirim pesan ke RTDB
async function sendChatMessage() {
  const text = (chatText?.value || "").trim();
  if (!text) return;

  const msgRef = push(chatRef);
  await set(msgRef, {
    nickname,
    message: text,
    timestamp: Date.now()
  });

  chatText.value = "";
}

function autoResizeChat() {
  if (!chatText) return;

  const maxHeight = 120;
  chatText.style.height = "auto";
  const newHeight = Math.min(chatText.scrollHeight, maxHeight);

  chatText.style.height = newHeight + "px";
  chatText.style.overflowY = (chatText.scrollHeight > maxHeight) ? "auto" : "hidden";
}

// listener realtime chat
function attachChatListener() {
  if (chatListenerAttached) return;

  const q = query(chatRef, orderByChild("timestamp"));
  onChildAdded(q, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.message) return;

    const name = data.nickname || "User";
    const isSelf = (name === nickname);
    appendChatMessage(name, data.message, isSelf);
  });

  chatListenerAttached = true;
}

// event kirim chat
if (chatSend) {
  chatSend.addEventListener("click", () => {
    sendChatMessage().catch(console.error);
  });
}

if (chatText) {
  chatText.addEventListener("input", () => autoResizeChat());
  chatText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage().catch(console.error);
    }
  });
}

// optional: collapse/expand chat
if (chatHeader && chatMessages) {
  chatHeader.addEventListener("click", () => {
    const body = chatMessages.parentElement?.querySelector(".chat-body");
    const icon = chatHeader.querySelector(".expand-icon");
    if (!body) return;

    const collapsed = body.style.display === "none";
    body.style.display = collapsed ? "block" : "none";
    if (icon) icon.textContent = collapsed ? "▲" : "▼";
  });
}

// =====================================================
// NOTES FUNCTION
// =====================================================
const notesWindow = document.getElementById("notesWindow");
const notesBtn = document.getElementById("btnNotes");
const closeNotes = document.getElementById("closeNotes");

const notesFields = {
  timestamp: document.getElementById("notesDate"),
  patient_name: document.getElementById("patientNameInput"),
  mother_age: document.getElementById("motherAgeInput"),
  gestational_age: document.getElementById("gestAgeInput"),
  bpd: document.getElementById("bpdInput"),
  hc: document.getElementById("hcInput"),
  ac: document.getElementById("acInput"),
  fl: document.getElementById("flInput"),
  efw: document.getElementById("efwInput"),
  anatomy_assessment: document.getElementById("anatomyInput"),
  diagnosis: document.getElementById("diagnosisInput"),
  recommendations: document.getElementById("rekomInput"),
  additional_notes: document.getElementById("additionalInput")
};

const notesRef = ref(db, `notes/${roomID}`);

if (notesBtn && notesWindow) {
  notesBtn.addEventListener("click", () => {
    notesWindow.classList.remove("hidden");
  });
}

if (closeNotes && notesWindow) {
  closeNotes.addEventListener("click", () => {
    notesWindow.classList.add("hidden");
  });
}

onValue(notesRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  for (const key in notesFields) {
    if (notesFields[key]) {
      notesFields[key].value = data[key] || "";
    }
  }
});

// SAVE TO FIREBASE (debounce)
let notesTimer = null;

function saveNotes() {
  const now = new Date().toISOString();
  const payload = { timestamp: now };

  for (const key in notesFields) {
    payload[key] = notesFields[key]?.value || "";
  }

  set(notesRef, payload);
}

for (const key in notesFields) {
  if (!notesFields[key]) continue;
  notesFields[key].addEventListener("input", () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveNotes, 400);
  });
}

// =====================================================
// DOM VIDEO / MEETING
// =====================================================
const cam0 = document.getElementById("camera0");   // remote main video
const cam1 = document.getElementById("camera1");   // local preview
const cam2 = document.getElementById("camera2");   // remote USG (track ke-2)
const box2 = document.getElementById("box2");

// USG video layer (local preview stream dari canvas) — opsional di HTML
const usgVideoEl = document.getElementById("usgVideo");

const placeholder0 = document.getElementById("placeholder0");
const placeholder1 = document.getElementById("placeholder1");
const placeholder2 = document.getElementById("placeholder2");

const camOffIcon0 = document.getElementById("camOffIcon0");
const camOffIcon1 = document.getElementById("camOffIcon1");
const micOffIcon0 = document.getElementById("micOffIcon0");
const micOffIcon1 = document.getElementById("micOffIcon1");
const camOffIcon2 = document.getElementById("camOffIcon2");
const micOffIcon2 = document.getElementById("micOffIcon2");
const dimmer0 = document.getElementById("dimmer0");

const camSelect0 = document.getElementById("cameraSelect0");
const micBtn = document.getElementById("toggleMic");
const camBtn = document.getElementById("toggleCam");
const leaveBtn = document.getElementById("leaveBtn");

// =====================================================
// USG MODAL DOM
// =====================================================
const btnShareCam = document.getElementById("btnShareCam");
const usgModal = document.getElementById("usgModal");
const usgConfirm = document.getElementById("usgConfirm");
const usgCancel = document.getElementById("usgCancel");
const usgCamSelect = document.getElementById("usgCamSelect");

usgCanvas = document.getElementById("usgPreview");
usgCtx = usgCanvas ? usgCanvas.getContext("2d") : null;

onValue(usgStateRef, (snap) => {
  const st = snap.val() || {};
  usgActive = !!st.active;
  usgOwnerId = st.owner || null;

  // kalau ada yang share dan BUKAN saya => tombol dikunci
  if (btnShareCam) {
    const locked = (usgActive && usgOwnerId && usgOwnerId !== myId);
    btnShareCam.disabled = locked;
    btnShareCam.style.opacity = locked ? "0.5" : "1";
    btnShareCam.style.pointerEvents = locked ? "none" : "auto";
    btnShareCam.title = locked ? "USG sedang dishare oleh lawan bicara" : "Share USG Camera";
  }

  // layout receiver / sender harus selalu konsisten dengan state global
  // (misal: share stop -> camera2 harus hidden lagi, camera0 balik normal)
  applyLayout();
});

// =====================================================
// HELPERS: VIDEO VISIBILITY
// =====================================================
function showVideoEl(videoEl) {
  if (!videoEl) return;
  videoEl.style.display = "block";
  videoEl.classList.add("play");
}

function hideVideoEl(videoEl) {
  if (!videoEl) return;
  videoEl.style.display = "none";
  videoEl.classList.remove("play");
}

function drawCanvasStatus(text) {
  if (!usgCtx || !usgCanvas) return;
  usgCtx.clearRect(0, 0, usgCanvas.width, usgCanvas.height);
  usgCtx.fillStyle = "black";
  usgCtx.fillRect(0, 0, usgCanvas.width, usgCanvas.height);
  usgCtx.fillStyle = "white";
  usgCtx.font = "20px sans-serif";
  usgCtx.textAlign = "center";
  usgCtx.textBaseline = "middle";
  usgCtx.fillText(text, usgCanvas.width / 2, usgCanvas.height / 2);
}

function setWaitingUIForSlot(slot) {
  // slot: 0 (remote main) atau 2 (remote USG)
  if (slot === 0) {
    hideVideoEl(cam0);
    if (placeholder0) {
      placeholder0.style.display = "flex";
      placeholder0.textContent = "Menunggu lawan bicara...";
    }
    if (camOffIcon0) camOffIcon0.style.display = "none";
    if (dimmer0) dimmer0.style.display = "none";
  } else {
    if (!box2) return;
    if (placeholder2) {
      placeholder2.style.display = "flex";
      placeholder2.textContent = "Menunggu USG...";
    }
    hideVideoEl(cam2);
  }
}

function setRemoteMainStreamToUI(stream) {
  remoteStreamLatest = stream || null;

  if (!peerId) {
    setWaitingUIForSlot(0);
    return;
  }

  if (isShareLayout()) {
    // SHARE MODE: remote main harus di camera2
    if (box2) box2.classList.remove("hidden");

    if (cam2) cam2.srcObject = stream || null;

    if (stream) {
      showVideoEl(cam2);
      if (placeholder2) placeholder2.style.display = "none";
      if (camOffIcon2) camOffIcon2.style.display = "none";
    } else {
      hideVideoEl(cam2);
      if (placeholder2) placeholder2.style.display = "flex";
      if (camOffIcon2) camOffIcon2.style.display = "block";
    }

    // camera0 jangan disentuh di sini (reserved untuk USG)
    return;
  }

  // NORMAL MODE: remote main di camera0
  if (cam0) cam0.srcObject = stream || null;

  if (stream) {
    showVideoEl(cam0);
    if (placeholder0) placeholder0.style.display = "none";
    if (camOffIcon0) camOffIcon0.style.display = "none";
  } else {
    hideVideoEl(cam0);
    if (placeholder0) placeholder0.style.display = "flex";
    if (camOffIcon0) camOffIcon0.style.display = "block";
  }

  // normal mode -> box2 harus hidden
  if (box2) box2.classList.add("hidden");
}

function setUSGBoxVisible(visible) {
  if (!box2) return;
  if (visible) box2.classList.remove("hidden");
  else box2.classList.add("hidden");
}

// =====================================================
// LAYOUT / STATE ROUTING (NORMAL vs SHARE)
// =====================================================
let cam0Locked = false;        // ketika share-mode, cam0 dipakai untuk USG dan tidak boleh diutak-atik oleh event kamera lawan
let remoteCamOn = true;        // state kamera lawan (dari signaling)
let remoteMicOn = true;        // state mic lawan (dari signaling)

function lockCam0(lock) {
  cam0Locked = !!lock;
}

function setRemoteCamIconsForShareLayout() {
  // SHARE layout: ikon lawan harus muncul di camera2
  if (camOffIcon0) camOffIcon0.style.display = "none";
  if (micOffIcon0) micOffIcon0.style.display = "none";

  if (camOffIcon2) camOffIcon2.style.display = remoteCamOn ? "none" : "block";
  if (micOffIcon2) micOffIcon2.style.display = remoteMicOn ? "none" : "block";
}

function setRemoteCamIconsForNormalLayout() {
  // NORMAL layout: ikon lawan di camera0
  if (camOffIcon2) camOffIcon2.style.display = "none";
  if (micOffIcon2) micOffIcon2.style.display = "none";

  if (camOffIcon0) camOffIcon0.style.display = remoteCamOn ? "none" : "block";
  if (micOffIcon0) micOffIcon0.style.display = remoteMicOn ? "none" : "block";
}

function applyLayout() {
  const share = isShareLayout();

  if (share) {
    lockCam0(true);

    // cam0 = USG (local atau remote)
    const usgSrc =
      (usgSharing && usgStream) ? usgStream :
      (remoteUsgStreamLatest) ? remoteUsgStreamLatest :
      null;

    if (usgSrc) {
      if (cam0) cam0.srcObject = usgSrc;
      showVideoEl(cam0);
      if (placeholder0) placeholder0.style.display = "none";
    } else {
      hideVideoEl(cam0);
      if (placeholder0) {
        placeholder0.style.display = "flex";
        placeholder0.textContent = "Mengirim/menunggu USG...";
      }
    }

    // cam2 = kamera lawan (main)
    if (box2) box2.classList.remove("hidden");
    if (cam2) cam2.srcObject = remoteStreamLatest || null;

    if (remoteStreamLatest && remoteCamOn) {
      showVideoEl(cam2);
      if (placeholder2) placeholder2.style.display = "none";
    } else {
      hideVideoEl(cam2);
      if (placeholder2) {
        placeholder2.style.display = "flex";
        placeholder2.textContent = "";
      }
    }

    setRemoteCamIconsForShareLayout();
    return;
  }

  // NORMAL layout
  lockCam0(false);

  // cam0 = kamera lawan (main)
  if (cam0) cam0.srcObject = remoteStreamLatest || null;
  if (remoteStreamLatest && remoteCamOn) {
    showVideoEl(cam0);
    if (placeholder0) placeholder0.style.display = "none";
  } else if (peerId) {
    hideVideoEl(cam0);
    if (placeholder0) {
      placeholder0.style.display = "flex";
      placeholder0.textContent = "";
    }
  } else {
    setWaitingUIForSlot(0);
  }

  // box2 disembunyikan total
  if (cam2) cam2.srcObject = null;
  if (box2) box2.classList.add("hidden");
  if (placeholder2) placeholder2.style.display = "none";

  setRemoteCamIconsForNormalLayout();
}


// =====================================================
// USG: WebSocket connect for preview/stream (Python)
// =====================================================
function closeUSGWS() {
  try {
    if (usgWS) {
      try { usgWS.send(JSON.stringify({ action: "stop-share" })); } catch { }
      usgWS.close();
    }
  } catch { }
  usgWS = null;
}

function stopUSGFrameWatchdog() {
  if (usgFrameTimer) {
    clearTimeout(usgFrameTimer);
    usgFrameTimer = null;
  }
}

function armUSGFrameWatchdog() {
  stopUSGFrameWatchdog();
  usgFrameTimer = setTimeout(() => {
    drawCanvasStatus("Kamera tidak tersedia");
  }, 1500);
}

function connectUSGPreview() {
  if (!usgCanvas || !usgCtx) return;

  closeUSGWS();
  drawCanvasStatus("Menghubungkan kamera...");

  usgWS = new WebSocket("ws://127.0.0.1:9000");
  usgWS.binaryType = "arraybuffer";

  usgWS.onopen = () => {
    try { usgWS.send(JSON.stringify({ action: "list-cameras" })); } catch { }
    armUSGFrameWatchdog();
  };

  usgWS.onmessage = async (evt) => {
    // JSON message
    if (typeof evt.data === "string") {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.action === "camera-list" && Array.isArray(msg.cameras)) {
          populateUSGCameraSelect(msg.cameras);

          // auto preview kamera terpilih
          const idx = Number(usgCamSelect?.value ?? (msg.cameras[0] ?? 0));
          try {
            usgWS.send(JSON.stringify({ action: "preview-camera", index: idx }));
          } catch { }

          return;
        }
      } catch { }
      return;
    }

    // binary jpeg
    armUSGFrameWatchdog();
    try {
      const blob = new Blob([evt.data], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      usgCtx.drawImage(bitmap, 0, 0, usgCanvas.width, usgCanvas.height);
    } catch {
      drawCanvasStatus("Kamera tidak tersedia");
    }
  };

  usgWS.onerror = () => {
    drawCanvasStatus("Kamera tidak tersedia");
  };

  usgWS.onclose = () => {
    stopUSGFrameWatchdog();
  };
}

function populateUSGCameraSelect(list) {
  if (!usgCamSelect) return;

  // pertahankan pilihan user jika masih ada
  const prev = usgCamSelect.value;

  usgCamSelect.innerHTML = "";
  let first = null;
  let prevStillExists = false;

  list.forEach((idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `Camera ${idx}`;
    usgCamSelect.appendChild(opt);

    if (first === null) first = String(idx);
    if (prev !== "" && String(idx) === String(prev)) prevStillExists = true;
  });

  // restore selection
  if (prevStillExists) usgCamSelect.value = String(prev);
  else if (first !== null) usgCamSelect.value = first;
}

// =====================================================
// USG SHARE: Start / Stop
// MODE B: send USG as second WebRTC video track (NOT replacing camera)
// =====================================================
async function ensureUsgSenderAndSendTrack(track) {
  if (!pc || !track) return;

  // jika sudah ada sender, replace track
  if (usgSender) {
    try {
      await usgSender.replaceTrack(track);
    } catch (e) {
      console.warn("usgSender.replaceTrack failed:", e);
    }
    await forceRenegotiate();
    return;
  }

  // belum ada sender: addTrack sebagai track video ke-2
  // NOTE: ini akan memicu negotiationneeded juga, tapi kita paksa renegotiate agar konsisten
  try {
    usgSender = pc.addTrack(track, usgStream || new MediaStream([track]));
  } catch (e) {
    console.warn("pc.addTrack USG failed:", e);
    usgSender = null;
    return;
  }

  await forceRenegotiate();
}

async function startShareUSG() {
  // LOCK: kalau ada share aktif dan bukan saya, tidak boleh mulai
  if (usgActive && usgOwnerId && usgOwnerId !== myId) {
    alert("USG sedang dishare oleh lawan bicara.");
    return;
  }

  usgSharing = true;

  // 1) pastikan python mulai stream sesuai kamera terpilih
  const idx = Number(usgCamSelect?.value ?? 0);
  try {
    if (usgWS && usgWS.readyState === WebSocket.OPEN) {
      usgWS.send(JSON.stringify({ action: "start-share", index: idx }));
    }
  } catch {}

  // 2) ambil stream dari canvas (ini USG)
  if (!usgCanvas) return;

  // pastikan stream lama mati
  if (usgStream) {
    try { usgStream.getTracks().forEach(t => t.stop()); } catch {}
    usgStream = null;
  }

  usgStream = usgCanvas.captureStream(20);
  const usgTrack = usgStream.getVideoTracks()[0];

  // 3) LOCAL UI: camera0 tampil USG
  cam0.srcObject = usgStream;
  showVideoEl(cam0);
  if (placeholder0) placeholder0.style.display = "none";

  // camera2 disiapkan untuk remote main cam (kalau ada)
  if (box2) box2.classList.remove("hidden");
  if (remoteStreamLatest) {
    cam2.srcObject = remoteStreamLatest;
    showVideoEl(cam2);
    if (placeholder2) placeholder2.style.display = "none";
  }

  // 4) WEBRTC: JANGAN replace kamera.
  // kamera tetap via videoSender, USG jadi track video kedua via usgSender
  if (pc && usgTrack) {
    try {
      if (usgSender) {
        // kalau sebelumnya ada, ganti track saja
        await usgSender.replaceTrack(usgTrack);
      } else {
        usgSender = pc.addTrack(usgTrack, usgStream);
      }
      await forceRenegotiate();
    } catch (err) {
      console.error("Failed to attach USG track:", err);
    }
  }

  // 5) Update lock global via Firebase (ini yang mengunci tombol lawan)
  await set(usgStateRef, {
    active: true,
    owner: myId,
    ts: Date.now()
  });

  // 6) tombol UI
  const img = btnShareCam?.querySelector("img");
  if (img) img.src = "/static/img/Stop.png";

  applyLayout();
}

async function stopShareUSG() {
  if (!usgSharing) return;

  usgSharing = false;

  // 1) Lepas USG dari WebRTC (biar remote stop beneran)
  try {
    if (pc && usgSender) {
      pc.removeTrack(usgSender);
      usgSender = null;
      await forceRenegotiate();
    }
  } catch (err) {
    console.warn("removeTrack usgSender failed:", err);
  }

  // 2) Stop stream canvas
  try {
    if (usgStream) {
      usgStream.getTracks().forEach(t => t.stop());
      usgStream = null;
    }
  } catch {}

  // 3) Beritahu python STOP + close ws (biar kamera release)
  try {
    if (usgWS && usgWS.readyState === WebSocket.OPEN) {
      usgWS.send(JSON.stringify({ action: "stop-share" }));
    }
  } catch {}
  closeUSGWS();        // ini akan close socket
  stopUSGFrameWatchdog();

  // 4) LOCAL UI balik normal (camera0 = remote main cam)
  if (remoteStreamLatest) {
    cam0.srcObject = remoteStreamLatest;
    showVideoEl(cam0);
    if (placeholder0) placeholder0.style.display = "none";
  } else {
    setWaitingUIForSlot(0);
  }
  if (box2) box2.classList.add("hidden");

  // === RESET CAMERA2 UI TOTAL ===
  if (cam2) cam2.srcObject = null;
  if (placeholder2) placeholder2.style.display = "none";
  if (camOffIcon2) camOffIcon2.style.display = "none";
  if (micOffIcon2) micOffIcon2.style.display = "none";

  // 5) Update lock global => ini yang bikin UI lawan balik normal juga
  await set(usgStateRef, {
    active: false,
    owner: null,
    ts: Date.now()
  });

  // 6) tombol UI
  const img = btnShareCam?.querySelector("img");
  if (img) img.src = "/static/img/Share.png";

  applyLayout();
}

// =====================================================
// USG MODAL: open/close behavior
// =====================================================
function openUSGModal() {
  if (!usgModal) return;
  usgModal.classList.remove("hidden");
  connectUSGPreview();
}

function closeUSGModal() {
  if (!usgModal) return;
  usgModal.classList.add("hidden");
  closeUSGWS();
  stopUSGFrameWatchdog();
  if (usgCanvas && usgCtx) usgCtx.clearRect(0, 0, usgCanvas.width, usgCanvas.height);
}

// UI events
if (btnShareCam) {
  btnShareCam.addEventListener("click", () => {
    if (usgSharing) {
      stopShareUSG();
      return;
    }
    openUSGModal();
  });
}

if (usgConfirm) {
  usgConfirm.addEventListener("click", () => {
    const idx = Number(usgCamSelect?.value ?? 0);

    // minta python start-share kamera terpilih (biar stream stabil)
    try {
      if (usgWS && usgWS.readyState === WebSocket.OPEN) {
        usgWS.send(JSON.stringify({ action: "start-share", index: idx }));
      }
    } catch { }

    closeUSGModal();

    // connect lagi untuk terus menerima frame (preview stream dipakai untuk capture canvas)
    connectUSGPreview();

    startShareUSG();
  });
}

if (usgCancel) {
  usgCancel.addEventListener("click", () => {
    closeUSGModal();
  });
}

if (usgCamSelect) {
  usgCamSelect.addEventListener("change", () => {
    if (!usgWS || usgWS.readyState !== WebSocket.OPEN) return;
    const idx = Number(usgCamSelect.value);

    try {
      usgWS.send(JSON.stringify({ action: "preview-camera", index: idx }));
    } catch { }

    drawCanvasStatus("Mengganti kamera...");
    armUSGFrameWatchdog();
  });
}

// =====================================================
// STATE (MIC/CAM)
// =====================================================
let micOn = sessionStorage.getItem("micState") !== "false";  // default true
let camOn = sessionStorage.getItem("camState") !== "false";  // default true
let selectedCam = sessionStorage.getItem("selectedCamera") || null;

let localAudio = null;   // MediaStream (audio only)
let localVideo = null;   // MediaStream (video only)
let localStream = null;  // gabungan audio+video untuk preview

let pc = null;
let ws = null;
let myId = null;
let peerId = null;

let WS_URL = null;
let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

let audioSender = null;
let videoSender = null; // kamera utama (track 1)

// Set initial icon UI
if (micOffIcon1) micOffIcon1.style.display = micOn ? "none" : "block";
if (camOffIcon1) camOffIcon1.style.display = camOn ? "none" : "block";

if (micBtn?.querySelector("img")) {
  micBtn.querySelector("img").src = micOn
    ? "/static/img/Mic.png"
    : "/static/img/Mic off.png";
}

if (camBtn?.querySelector("img")) {
  camBtn.querySelector("img").src = camOn
    ? "/static/img/Icon.png"
    : "/static/img/Camera off.png";
}

// =====================================================
// LOAD CONFIG / ICE SERVERS
// =====================================================
async function loadConfig() {
  const resp = await fetch("/config");
  const json = await resp.json();
  WS_URL = json.signaling_url;
}

async function loadIceServers() {
  try {
    const resp = await fetch("/ice");
    const data = await resp.json();
    if (data.iceServers && data.iceServers.length) {
      iceServers = data.iceServers;
    }
  } catch (err) {
    console.warn("Failed to load ICE from TURN, using STUN only:", err);
  }
}

// =====================================================
// MEDIA HANDLING
// =====================================================
function rebuildLocalStream() {
  const tracks = [];

  if (localAudio) {
    localAudio.getAudioTracks().forEach(t => {
      t.enabled = micOn;
      tracks.push(t);
    });
  }

  if (localVideo) {
    localVideo.getVideoTracks().forEach(t => {
      t.enabled = camOn;
      tracks.push(t);
    });
  }

  localStream = new MediaStream(tracks);
  if (cam1) cam1.srcObject = localStream;
  if (cam1) cam1.muted = true;

  // re-attach audio sender kalau perlu
  if (pc) {
    const aTrack = localAudio?.getAudioTracks()[0];
    if (aTrack) {
      if (!audioSender || audioSender.track !== aTrack) {
        try { if (audioSender) pc.removeTrack(audioSender); } catch { }
        audioSender = pc.addTrack(aTrack, localStream);
        forceRenegotiate().catch(console.error);
      }
    }
  }
}

async function restartFullMedia() {
  console.log("🔄 Restarting ALL media tracks...");

  if (localAudio) localAudio.getTracks().forEach(t => t.stop());
  if (localVideo) localVideo.getTracks().forEach(t => t.stop());
  localAudio = null;
  localVideo = null;
  localStream = null;

  localAudio = await navigator.mediaDevices.getUserMedia({ audio: true });
  localAudio.getAudioTracks().forEach(t => (t.enabled = micOn));

  localVideo = await navigator.mediaDevices.getUserMedia({
    video: selectedCam ? { deviceId: { exact: selectedCam } } : true
  });
  localVideo.getVideoTracks().forEach(t => (t.enabled = camOn));

  rebuildLocalStream();
  updateLocalVideoUI();

  if (pc) {
    const aTrack = localAudio.getAudioTracks()[0];
    const vTrack = localVideo.getVideoTracks()[0];

    // hapus semua sender kecuali usgSender (track kedua) — jangan ganggu usgSender
    const senders = pc.getSenders();
    for (const s of senders) {
      if (s === usgSender) continue;
      try { pc.removeTrack(s); } catch { }
    }

    audioSender = pc.addTrack(aTrack, localStream);
    videoSender = pc.addTrack(vTrack, localStream);

    await forceRenegotiate();
  }
}

function updateLocalVideoUI() {
  const live =
    camOn &&
    localVideo &&
    localVideo.getVideoTracks().some(t => t.readyState === "live");

  if (live) {
    if (cam1) cam1.style.display = "block";
    if (placeholder1) placeholder1.style.display = "none";
    if (camOffIcon1) camOffIcon1.style.display = "none";
  } else {
    if (cam1) cam1.style.display = "none";
    if (placeholder1) placeholder1.style.display = "flex";
    if (camOffIcon1) camOffIcon1.style.display = "block";
  }
}

async function startMic() {
  if (!localAudio) {
    localAudio = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  localAudio.getAudioTracks().forEach(t => (t.enabled = micOn));
  rebuildLocalStream();

  if (pc && !audioSender) {
    const aTrack = localAudio.getAudioTracks()[0];
    if (aTrack) {
      audioSender = pc.addTrack(aTrack, localStream || new MediaStream([aTrack]));
    }
  }
}

async function startCamera(deviceId) {
  try {
    localVideo = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true
    });
    localVideo.getVideoTracks().forEach(t => (t.enabled = camOn));

    rebuildLocalStream();
    updateLocalVideoUI();

  } catch (err) {
    console.error("Camera error:", err);
    localVideo = null;
    updateLocalVideoUI();
  }
}

// =====================================================
// CAMERA DEVICE LIST
// =====================================================
async function loadCamerasMeeting() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");

    if (camSelect0) camSelect0.innerHTML = "";
    cams.forEach((cam, idx) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Kamera ${idx}`;
      camSelect0?.appendChild(opt);
    });

    if (!selectedCam && cams.length) selectedCam = cams[0].deviceId;
    if (selectedCam && camSelect0) camSelect0.value = selectedCam;

    if (camOn && selectedCam) await startCamera(selectedCam);
    else updateLocalVideoUI();

  } catch (err) {
    console.error("loadCamerasMeeting failed:", err);
    updateLocalVideoUI();
  }
}

if (camSelect0) {
  camSelect0.addEventListener("change", async (e) => {
    selectedCam = e.target.value || null;
    sessionStorage.setItem("selectedCamera", selectedCam || "");
    if (camOn && selectedCam) {
      await startCamera(selectedCam);
      // kalau sudah punya peer, ganti track kamera utama tanpa ganggu usgSender
      if (pc && videoSender && localVideo) {
        try {
          await videoSender.replaceTrack(localVideo.getVideoTracks()[0]);
        } catch { }
        await forceRenegotiate();
      }
    }
  });
}

// =====================================================
// UI TOGGLES (MIC & CAM)
// =====================================================
if (micBtn) {
  micBtn.addEventListener("click", () => {
    micOn = !micOn;
    sessionStorage.setItem("micState", String(micOn));

    if (localAudio) localAudio.getAudioTracks().forEach(t => (t.enabled = micOn));

    const img = micBtn.querySelector("img");
    if (img) img.src = micOn ? "/static/img/Mic.png" : "/static/img/Mic off.png";
    if (micOffIcon1) micOffIcon1.style.display = micOn ? "none" : "block";

    if (ws && peerId) {
      ws.send(JSON.stringify({
        action: "mic-state",
        target: peerId,
        state: micOn
      }));
    }
  });
}

if (camBtn) {
  camBtn.addEventListener("click", async () => {
    camOn = !camOn;
    sessionStorage.setItem("camState", String(camOn));

    // ===============================
    // MODE NORMAL (TIDAK SHARE USG)
    // ===============================
    if (!usgSharing) {
      if (!camOn) {
        if (localVideo) localVideo.getTracks().forEach(t => t.stop());
        localVideo = null;
        updateLocalVideoUI();

        if (videoSender) {
          await videoSender.replaceTrack(null).catch(() => {});
          await forceRenegotiate().catch(console.error);
        }
      } else {
        await restartFullMedia();
      }
    }

    // ===============================
    // MODE SHARE USG
    // ===============================
    else {
      if (!camOn) {
        // ❗ MATIKAN KAMERA LOKAL SAJA (camera2 di remote)
        if (videoSender) {
          await videoSender.replaceTrack(null).catch(() => {});
          await forceRenegotiate().catch(console.error);
        }

        // UI lokal
        hideVideoEl(cam1);
      } else {
        // NYALAKAN KAMERA LOKAL KEMBALI
        await restartCameraOnly();

        const vTrack = localVideo?.getVideoTracks?.()[0];
        if (vTrack && videoSender) {
          await videoSender.replaceTrack(vTrack).catch(() => {});
          await forceRenegotiate().catch(console.error);
        }

        showVideoEl(cam1);
      }
    }

    // update icon
    const img = camBtn.querySelector("img");
    if (img) {
      img.src = camOn
        ? "/static/img/Icon.png"
        : "/static/img/Camera off.png";
    }

    // kirim state ke peer
    if (ws && peerId) {
      ws.send(JSON.stringify({
        action: "camera-state",
        target: peerId,
        state: camOn
      }));
    }
  });
}

async function restartCameraOnly() {
  if (localVideo) {
    localVideo.getTracks().forEach(t => t.stop());
  }

  localVideo = await navigator.mediaDevices.getUserMedia({
    video: selectedCam ? { deviceId: { exact: selectedCam } } : true
  });

  localVideo.getVideoTracks().forEach(t => (t.enabled = camOn));

  rebuildLocalStream();
}

// =====================================================
// WEBRTC CORE
// =====================================================
function updateRemoteUI(hasVideo) {
  // UI kamera lawan harus mengikuti layout (normal vs share)
  remoteCamOn = !!hasVideo;

  if (!peerId) {
    setWaitingUIForSlot(0);
    return;
  }

  if (isShareLayout()) {
    // SHARE layout: kamera lawan ada di camera2
    if (hasVideo) {
      showVideoEl(cam2);
      if (placeholder2) placeholder2.style.display = "none";
      if (camOffIcon2) camOffIcon2.style.display = "none";
    } else {
      hideVideoEl(cam2);
      if (placeholder2) {
        placeholder2.style.display = "flex";
        placeholder2.textContent = "";
      }
      if (camOffIcon2) camOffIcon2.style.display = "block";
    }
    // jangan ganggu cam0 (USG)
    return;
  }

  // NORMAL layout: kamera lawan di camera0
  if (hasVideo) {
    showVideoEl(cam0);
    if (placeholder0) placeholder0.style.display = "none";
    if (camOffIcon0) camOffIcon0.style.display = "none";
    if (dimmer0) dimmer0.style.display = "none";
  } else {
    hideVideoEl(cam0);
    if (placeholder0) {
      placeholder0.style.display = "flex";
      placeholder0.textContent = "";
    }
    if (camOffIcon0) camOffIcon0.style.display = "block";
    if (dimmer0) dimmer0.style.display = "none";
  }
}

async function doOffer() {
  if (!pc || !peerId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    action: "offer",
    target: peerId,
    sdp: offer.sdp,
    type: "offer"
  }));
}

function createPeerIfNeeded() {
  if (pc) return;

  pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = (e) => {
    if (e.candidate && ws && peerId) {
      ws.send(JSON.stringify({
        action: "candidate",
        target: peerId,
        candidate: e.candidate
      }));
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      await doOffer();
    } catch (err) {
      console.error("onnegotiationneeded error:", err);
    }
  };

  // MODE B: max 2 video track (kamera + USG)
  const seenVideoTracks = new Set();
  remoteUsgStreamLatest = null;

  pc.ontrack = (evt) => {
    const track = evt.track;
    const stream = evt.streams?.[0] || null;
    if (!track || track.kind !== "video") return;

    // pastikan unik
    if (seenVideoTracks.has(track.id)) return;
    seenVideoTracks.add(track.id);

    const remoteIsSharing =
      Boolean(usgActive && usgOwnerId && usgOwnerId !== myId);

    // ===== VIDEO MAIN (kamera lawan) =====
    if (
      !remoteStreamLatest ||
      (!remoteIsSharing && !remoteUsgStreamLatest &&
        stream &&
        remoteStreamLatest &&
        stream.id !== remoteStreamLatest.id)
    ) {
      remoteStreamLatest = stream;
      setRemoteMainStreamToUI(stream);

      track.onended = () => {
        if (remoteStreamLatest && stream && remoteStreamLatest.id === stream.id) {
          remoteStreamLatest = null;
        }
        applyLayout();
      };

      applyLayout();
      return;
    }

    // ===== VIDEO USG (track ke-2) =====
    if (!remoteIsSharing) {
      // safety: abaikan track ke-2 jika bukan USG
      return;
    }

    remoteUsgStreamLatest = new MediaStream([track]);
    applyLayout();

    track.onended = () => {
      remoteUsgStreamLatest = null;
      applyLayout();
    };
  };

  // Attach audio
  if (localAudio) {
    const aTrack = localAudio.getAudioTracks()[0];
    if (aTrack) {
      audioSender = pc.addTrack(aTrack, localStream || new MediaStream([aTrack]));
    }
  }

  // Attach kamera utama
  if (localVideo && camOn) {
    const vTrack = localVideo.getVideoTracks()[0];
    if (vTrack) {
      videoSender = pc.addTrack(vTrack, localStream || new MediaStream([vTrack]));
    }
  }

  // Attach USG jika sedang share
  if (usgSharing && usgStream) {
    const uTrack = usgStream.getVideoTracks()[0];
    if (uTrack) {
      try {
        usgSender = pc.addTrack(uTrack, usgStream);
      } catch {}
    }
  }
}

async function forceRenegotiate() {
  if (!pc || !peerId || !ws) return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
      action: "offer",
      target: peerId,
      sdp: offer.sdp,
      type: "offer"
    }));
  } catch (err) {
    console.error("forceRenegotiate error:", err);
  }
}

async function handleOffer(data) {
  createPeerIfNeeded();

  await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  ws.send(JSON.stringify({
    action: "answer",
    target: data.from,
    sdp: answer.sdp,
    type: "answer"
  }));
}

// =====================================================
// SIGNALING (WebSocket)
// =====================================================
function connectWS() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);

    ws.onmessage = async (evt) => {
      let data;
      try {
        data = JSON.parse(evt.data);
      } catch {
        return;
      }

      switch (data.action) {

        case "id":
          myId = data.id;
          break;

        case "peers":
          if (data.peers && data.peers.length > 0) {
            peerId = String(data.peers[0]);
            createPeerIfNeeded();
            await doOffer();

            setTimeout(() => {
              if (!peerId || !ws || ws.readyState !== WebSocket.OPEN) return;
              ws.send(JSON.stringify({
                action: "camera-state",
                target: peerId,
                state: camOn
              }));
              ws.send(JSON.stringify({
                action: "mic-state",
                target: peerId,
                state: micOn
              }));
            }, 500);
          }
          break;

        case "offer":
          peerId = String(data.from);
          await handleOffer(data);
          break;

        case "answer":
          if (pc) {
            await pc.setRemoteDescription({
              type: data.type,
              sdp: data.sdp
            });
          }
          break;

        case "candidate":
          if (pc && data.candidate) {
            try {
              await pc.addIceCandidate(data.candidate);
            } catch (err) {
              console.warn("addIceCandidate failed:", err);
            }
          }
          break;

        case "usg-start":
          usgActive = true;
          usgOwnerId = data.owner;
          btnShareCam.disabled = (data.owner !== myId);
          applyLayout();
          break;

        case "usg-stop":
          usgActive = false;
          usgOwnerId = null;
          btnShareCam.disabled = false;
          remoteUsgStreamLatest = null;
          applyLayout();
          break;

        case "camera-state":
          remoteCamOn = Boolean(data.state);
          applyLayout();
          break;

        case "mic-state":
          remoteMicOn = Boolean(data.state);
          applyLayout();
          break;

        case "peer-leave":
          remoteStreamLatest = null;
          remoteUsgStreamLatest = null;

          if (cam0) cam0.srcObject = null;
          if (cam2) cam2.srcObject = null;

          if (pc) pc.close();
          pc = null;
          peerId = null;

          applyLayout();
          break;
      }
    };
  });
}

// =====================================================
// LEAVE & CLEANUP
// =====================================================
function cleanupLocal() {
  try { ws && ws.close(); } catch { }
  try { pc && pc.close(); } catch { }

  // stop USG kalau lagi sharing / preview
  try { stopShareUSG(); } catch { }
  try { closeUSGModal(); } catch { }

  if (localAudio) {
    localAudio.getTracks().forEach(t => t.stop());
    localAudio = null;
  }
  if (localVideo) {
    localVideo.getTracks().forEach(t => t.stop());
    localVideo = null;
  }

  try { off(chatRef); } catch { }
}

if (leaveBtn) {
  leaveBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "leave" }));
    }
    cleanupLocal();
    window.location.href = "/dashboard";
  });
}

window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "leave" }));
  }
  cleanupLocal();
});

// =====================================================
// INIT
// =====================================================
(async () => {
  await loadConfig();
  await loadIceServers();
  await startMic();
  await loadCamerasMeeting();
  await connectWS();

  attachChatListener();

  ws.send(JSON.stringify({
    action: "join",
    room: roomID,
    uid: null
  }));

  // init remote UI
  setWaitingUIForSlot(0);
  setUSGBoxVisible(false);
})();
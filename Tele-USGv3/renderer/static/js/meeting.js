// =====================================================
// MEETING.JS — FINAL FIX: CAMERA + MIC + CHAT
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
  appId: "1:623391086693:web:fbd62c11da5b6f80f6ce8c"
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
let chatRef = ref(db, `chats/${roomID}`);
let chatListenerAttached = false;

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

    // tentukan apakah pesan dari kita sendiri
    if (isSelf) {
        wrapper.classList.add("chat-self");
    } else {
        wrapper.classList.add("chat-other");

        // tampilkan nama di atas bubble
        const nameDiv = document.createElement("div");
        nameDiv.classList.add("chat-name");
        nameDiv.textContent = name;
        wrapper.appendChild(nameDiv);
    }

    const msgDiv = document.createElement("div");
    msgDiv.textContent = message;

    wrapper.appendChild(msgDiv);
    chatMessages.appendChild(wrapper);

    // auto scroll ke bawah
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// kirim pesan ke RTDB
async function sendChatMessage() {
  const text = (chatText.value || "").trim();
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

  const minHeight = 40;   // tinggi default
  const maxHeight = 120;  // batas maksimal

  chatText.style.height = "auto"; // reset dulu
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
  // Auto expand textarea
  chatText.addEventListener("input", () => {
      autoResizeChat();
  });
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
    const body = chatMessages.parentElement.querySelector(".chat-body");
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

// SHOW NOTES WINDOW
notesBtn.addEventListener("click", () => {
  notesWindow.classList.remove("hidden");
});

// HIDE NOTES WINDOW
closeNotes.addEventListener("click", () => {
  notesWindow.classList.add("hidden");
});

// SYNC REALTIME FROM FIREBASE
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
    payload[key] = notesFields[key].value || "";
  }

  set(notesRef, payload);
}

for (const key in notesFields) {
  notesFields[key].addEventListener("input", () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveNotes, 400);
  });
}

// =====================================================
// DOM VIDEO / MEETING
// =====================================================
const cam0 = document.getElementById("camera0");   // remote
const cam1 = document.getElementById("camera1");   // local

const placeholder0 = document.getElementById("placeholder0");
const placeholder1 = document.getElementById("placeholder1");

const camOffIcon0 = document.getElementById("camOffIcon0");
const camOffIcon1 = document.getElementById("camOffIcon1");
const micOffIcon0 = document.getElementById("micOffIcon0");
const micOffIcon1 = document.getElementById("micOffIcon1");
const dimmer0 = document.getElementById("dimmer0");

const camSelect0 = document.getElementById("cameraSelect0");
const micBtn = document.getElementById("toggleMic");
const camBtn = document.getElementById("toggleCam");
const leaveBtn = document.getElementById("leaveBtn");

// ---------------------------
// STATE
// ---------------------------
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
let videoSender = null;

// ---------------------------
// Set initial icon UI
// ---------------------------
micOffIcon1.style.display = micOn ? "none" : "block";
camOffIcon1.style.display = camOn ? "none" : "block";

micBtn.querySelector("img").src = micOn
  ? "/static/img/Mic.png"
  : "/static/img/Mic off.png";

camBtn.querySelector("img").src = camOn
  ? "/static/img/Icon.png"
  : "/static/img/Camera off.png";

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

  // AUDIO TIDAK BOLEH HILANG
  if (localAudio) {
    localAudio.getAudioTracks().forEach(t => {
      t.enabled = micOn;
      tracks.push(t);
    });
  }

  // VIDEO OPTIONAL
  if (localVideo) {
    localVideo.getVideoTracks().forEach(t => {
      t.enabled = camOn;
      tracks.push(t);
    });
  }

  // BUAT STREAM BARU (preview)
  localStream = new MediaStream(tracks);
  cam1.srcObject = localStream;
  cam1.muted = true;

  // re-attach audio sender kalau perlu
  if (pc) {
    const aTrack = localAudio?.getAudioTracks()[0];
    if (aTrack) {
      if (!audioSender || audioSender.track !== aTrack) {
        try {
          if (audioSender) pc.removeTrack(audioSender);
        } catch { }

        audioSender = pc.addTrack(aTrack, localStream);
        forceRenegotiate();
      }
    }
  }
}

async function restartFullMedia() {
  console.log("🔄 Restarting ALL media tracks...");

  // ---- stop existing streams ----
  if (localAudio) localAudio.getTracks().forEach(t => t.stop());
  if (localVideo) localVideo.getTracks().forEach(t => t.stop());
  localAudio = null;
  localVideo = null;
  localStream = null;

  // ---- get fresh audio ----
  localAudio = await navigator.mediaDevices.getUserMedia({ audio: true });
  localAudio.getAudioTracks().forEach(t => (t.enabled = micOn));

  // ---- get fresh video ----
  localVideo = await navigator.mediaDevices.getUserMedia({
    video: selectedCam ? { deviceId: { exact: selectedCam } } : true
  });
  localVideo.getVideoTracks().forEach(t => (t.enabled = true));

  // ---- rebuild preview ----
  rebuildLocalStream();
  updateLocalVideoUI();

  // ---- reattach to PC ----
  if (pc) {
    const aTrack = localAudio.getAudioTracks()[0];
    const vTrack = localVideo.getVideoTracks()[0];

    pc.getSenders().forEach(s => pc.removeTrack(s));

    audioSender = pc.addTrack(aTrack, localStream);
    videoSender = pc.addTrack(vTrack, localStream);

    await forceRenegotiate();
  }
}

function updateLocalVideoUI() {
  if (camOn && localVideo && localVideo.getVideoTracks().some(t => t.readyState === "live")) {
    cam1.style.display = "block";
    placeholder1.style.display = "none";
    camOffIcon1.style.display = "none";
  } else {
    cam1.style.display = "none";
    placeholder1.style.display = "flex";
    camOffIcon1.style.display = "block";
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

function stopLocalVideo() {
  if (localVideo) {
    localVideo.getTracks().forEach(t => t.stop());
  }
  localVideo = null;
  rebuildLocalStream();
}

// =====================================================
// CAMERA DEVICE LIST
// =====================================================
async function loadCamerasMeeting() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");

    camSelect0.innerHTML = "";
    cams.forEach((cam, idx) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Kamera ${idx}`;
      camSelect0.appendChild(opt);
    });

    if (!selectedCam && cams.length) {
      selectedCam = cams[0].deviceId;
    }

    if (selectedCam) {
      camSelect0.value = selectedCam;
    }

    if (camOn && selectedCam) {
      await startCamera(selectedCam);
    } else {
      updateLocalVideoUI();
    }
  } catch (err) {
    console.error("loadCamerasMeeting failed:", err);
    updateLocalVideoUI();
  }
}

camSelect0.addEventListener("change", async (e) => {
  selectedCam = e.target.value || null;
  sessionStorage.setItem("selectedCamera", selectedCam || "");
  if (camOn && selectedCam) {
    await startCamera(selectedCam);
  }
});

// =====================================================
// UI TOGGLES (MIC & CAM)
// =====================================================
micBtn.addEventListener("click", () => {
  micOn = !micOn;
  sessionStorage.setItem("micState", String(micOn));

  if (localAudio) {
    localAudio.getAudioTracks().forEach(t => (t.enabled = micOn));
  }

  micBtn.querySelector("img").src = micOn
    ? "/static/img/Mic.png"
    : "/static/img/Mic off.png";

  micOffIcon1.style.display = micOn ? "none" : "block";

  if (ws && peerId) {
    ws.send(JSON.stringify({
      action: "mic-state",
      target: peerId,
      state: micOn
    }));
  }
});

camBtn.addEventListener("click", async () => {
  camOn = !camOn;
  sessionStorage.setItem("camState", String(camOn));

  if (!camOn) {
    if (localVideo) localVideo.getTracks().forEach(t => t.stop());
    localVideo = null;

    updateLocalVideoUI();

    if (videoSender) {
      await videoSender.replaceTrack(null);
    }

    camBtn.querySelector("img").src = "/static/img/Camera off.png";

    if (ws && peerId) {
      ws.send(JSON.stringify({
        action: "camera-state",
        target: peerId,
        state: false
      }));
    }

    return;
  }

  await restartFullMedia();

  camBtn.querySelector("img").src = "/static/img/Icon.png";

  if (ws && peerId) {
    ws.send(JSON.stringify({
      action: "camera-state",
      target: peerId,
      state: true
    }));
  }
});

// =====================================================
// WEBRTC CORE
// =====================================================
function updateRemoteUI(hasVideo) {
  // jika belum ada peer → murni menunggu lawan bicara
  if (!peerId) {
    cam0.style.display = "none";
    placeholder0.style.display = "flex";
    placeholder0.textContent = "Menunggu lawan bicara...";
    camOffIcon0.style.display = "none";
    if (dimmer0) dimmer0.style.display = "none";
    return;
  }

  // peer ada dan video ON
  if (hasVideo) {
    cam0.style.display = "block";
    placeholder0.style.display = "none";
    camOffIcon0.style.display = "none";
    if (dimmer0) dimmer0.style.display = "none";
    return;
  }

  // peer ada tapi kamera OFF
  cam0.style.display = "none";
  placeholder0.style.display = "flex";
  placeholder0.textContent = "";
  camOffIcon0.style.display = "block";
  if (dimmer0) dimmer0.style.display = "none";
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

  pc.ontrack = (evt) => {
    const stream = evt.streams[0];
    if (!stream) {
      updateRemoteUI(false);
      return;
    }

    if (cam0.srcObject !== stream) {
      cam0.srcObject = stream;
    }

    const videoTracks = stream.getVideoTracks();
    const hasVideo = videoTracks.some(
      (t) => t.readyState === "live" && t.enabled
    );

    updateRemoteUI(hasVideo);
  };

  pc.onremovetrack = () => {
    const stream = cam0.srcObject;
    if (!stream) {
      updateRemoteUI(false);
      return;
    }
    const vTracks = stream.getVideoTracks();
    const hasVideo = vTracks.some(
      (t) => t.readyState === "live" && t.enabled
    );
    updateRemoteUI(hasVideo);
  };

  // Attach track yang SUDAH ada
  if (localAudio) {
    const aTrack = localAudio.getAudioTracks()[0];
    if (aTrack) {
      audioSender = pc.addTrack(aTrack, localStream || new MediaStream([aTrack]));
    }
  }

  if (localVideo && camOn) {
    const vTrack = localVideo.getVideoTracks()[0];
    if (vTrack) {
      videoSender = pc.addTrack(vTrack, localStream || new MediaStream([vTrack]));
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

        case "camera-state":
          updateRemoteUI(Boolean(data.state));
          break;

        case "mic-state":
          micOffIcon0.style.display = data.state ? "none" : "block";
          break;

        case "peer-leave":
          updateRemoteUI(false);
          cam0.srcObject = null;
          if (pc) pc.close();
          pc = null;
          peerId = null;
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

  if (localAudio) {
    localAudio.getTracks().forEach(t => t.stop());
    localAudio = null;
  }
  if (localVideo) {
    localVideo.getTracks().forEach(t => t.stop());
    localVideo = null;
  }

  // lepas listener chat
  try {
    off(chatRef);
  } catch { }
}

leaveBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "leave" }));
  }
  cleanupLocal();
  window.location.href = "/dashboard";
});

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

  // mulai dengar chat room ini
  attachChatListener();

  ws.send(JSON.stringify({
    action: "join",
    room: roomID,
    uid: null
  }));
})();

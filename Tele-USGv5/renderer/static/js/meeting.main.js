// meeting.main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import * as rtdb from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { initChat } from "./meeting.chat.js";
import { initNotes } from "./meeting.notes.js";
import { initUSG } from "./meeting.usg.js";
import { initRTC } from "./meeting.rtc.js";

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
const db = rtdb.getDatabase(fbApp);

// ---------- Room ID ----------
const roomID = window.location.pathname.split("/").pop();
const roomInfo = document.getElementById("roomInfo");
if (roomInfo) roomInfo.textContent = "Room ID: " + roomID;

// ---------- DOM ----------
const elements = {
  // video
  cam0: document.getElementById("camera0"),
  cam1: document.getElementById("camera1"),
  cam2: document.getElementById("camera2"),
  box2: document.getElementById("box2"),

  placeholder0: document.getElementById("placeholder0"),
  placeholder1: document.getElementById("placeholder1"),
  placeholder2: document.getElementById("placeholder2"),

  camOffIcon0: document.getElementById("camOffIcon0"),
  micOffIcon0: document.getElementById("micOffIcon0"),
  camOffIcon1: document.getElementById("camOffIcon1"),
  micOffIcon1: document.getElementById("micOffIcon1"),
  camOffIcon2: document.getElementById("camOffIcon2"),
  micOffIcon2: document.getElementById("micOffIcon2"),
  dimmer0: document.getElementById("dimmer0"),

  // controls
  camSelect0: document.getElementById("cameraSelect0"),
  micBtn: document.getElementById("toggleMic"),
  camBtn: document.getElementById("toggleCam"),
  leaveBtn: document.getElementById("leaveBtn"),
  btnShareCam: document.getElementById("btnShareCam"),

  // chat
  chatMessages: document.getElementById("chatMessages"),
  chatText: document.getElementById("chatText"),
  chatSend: document.getElementById("chatSend"),
  chatHeader: document.getElementById("chatHeader"),

  // notes
  notesWindow: document.getElementById("notesWindow"),
  notesBtn: document.getElementById("btnNotes"),
  closeNotes: document.getElementById("closeNotes"),
  notesFields: {
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
  },

  // usg modal
  usgModal: document.getElementById("usgModal"),
  usgConfirm: document.getElementById("usgConfirm"),
  usgCancel: document.getElementById("usgCancel"),
  usgCamSelect: document.getElementById("usgCamSelect"),
  usgCanvas: document.getElementById("usgPreview"),
};
elements.usgCtx = elements.usgCanvas ? elements.usgCanvas.getContext("2d") : null;

// ---------- Shared state ----------
const state = {
  nickname: "User",
  myId: null,
  peerId: null,

  micOn: sessionStorage.getItem("micState") !== "false",
  camOn: sessionStorage.getItem("camState") !== "false",
  selectedCam: sessionStorage.getItem("selectedCamera") || null,

  WS_URL: null,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],

  localAudio: null,
  localVideo: null,
  localStream: null,
  audioSender: null,
  videoSender: null,

  // USG
  usgWS: null,
  usgSharing: false,
  usgStream: null,
  usgSender: null,
  usgFrameTimer: null,

  // remote
  remoteStreamLatest: null,
  remoteUsgStreamLatest: null,
  remoteCamOn: true,
  remoteMicOn: true,

  // global lock via RTDB
  usgActive: false,
  usgOwnerId: null,
};

// ---------- ctx ----------
const ctx = {
  firebaseDb: rtdb,
  auth, db, roomID, elements, state,
  ws: null,
};
ctx.usgStateRef = rtdb.ref(db, `rooms/${roomID}/usg`);

// ---------- Load config ----------
async function loadConfig() {
  const resp = await fetch("/config");
  const json = await resp.json();
  state.WS_URL = json.signaling_url;
}
async function loadIceServers() {
  try {
    const resp = await fetch("/ice");
    const data = await resp.json();
    if (data.iceServers && data.iceServers.length) state.iceServers = data.iceServers;
  } catch (e) {
    console.warn("Failed to load ICE, using STUN only", e);
  }
}

// ---------- Nickname ----------
onAuthStateChanged(auth, (user) => {
  if (user) state.nickname = user.displayName || (user.email ? user.email.split("@")[0] : "User");
});

// ---------- Modules ----------
const rtc = initRTC(ctx);
ctx.rtc = rtc;
const chat = initChat(ctx);
initNotes(ctx);
initUSG(ctx);

// ---------- Global USG lock listener ----------
rtdb.onValue(ctx.usgStateRef, (snap) => {
  const st = snap.val() || {};
  state.usgActive = !!st.active;
  state.usgOwnerId = st.owner || null;

  // lock button if someone else is sharing
  const disabled = (state.usgActive && state.usgOwnerId && state.usgOwnerId !== state.myId);
  if (elements.btnShareCam) {
    elements.btnShareCam.disabled = disabled;
    elements.btnShareCam.style.opacity = disabled ? "0.5" : "1";
    elements.btnShareCam.style.pointerEvents = disabled ? "none" : "auto";
    elements.btnShareCam.title = disabled ? "USG sedang dishare oleh lawan bicara" : "Share USG Camera";
  }

  // if remote stopped sharing, clear remote USG stream
  if (!state.usgActive) state.remoteUsgStreamLatest = null;

  ctx.applyLayout?.();
});

// ---------- UI binds ----------
if (elements.micBtn) elements.micBtn.addEventListener("click", () => rtc.toggleMic());
if (elements.camBtn) elements.camBtn.addEventListener("click", () => rtc.toggleCam());

// leave
function cleanupLocal() {
  try { ctx.ws && ctx.ws.close(); } catch {}
  try { rtc?.pc && rtc.pc.close(); } catch {}
  if (state.localAudio) { try { state.localAudio.getTracks().forEach(t=>t.stop()); } catch {} state.localAudio=null; }
  if (state.localVideo) { try { state.localVideo.getTracks().forEach(t=>t.stop()); } catch {} state.localVideo=null; }
  try { chat.cleanup(); } catch {}
}
if (elements.leaveBtn) {
  elements.leaveBtn.addEventListener("click", () => {
    if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) ctx.ws.send(JSON.stringify({ action: "leave" }));
    cleanupLocal();
    window.location.href = "/dashboard";
  });
}
window.addEventListener("beforeunload", () => {
  if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) ctx.ws.send(JSON.stringify({ action: "leave" }));
  cleanupLocal();
});

// ---------- Init ----------
(async () => {
  await loadConfig();
  await loadIceServers();

  await rtc.startMic();
  await rtc.loadCamerasMeeting();
  await rtc.connectWS();

  chat.attachChatListener();

  // join
  ctx.ws.send(JSON.stringify({ action: "join", room: roomID, uid: null }));

  // initial UI
  rtc.applyLayout();
})();

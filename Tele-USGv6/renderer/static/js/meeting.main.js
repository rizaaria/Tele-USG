// meeting.main.js - Main orchestrator for meeting room
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import * as rtdb from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { showToast } from "./toast.js";

import { initChat } from "./meeting.chat.js";
import { initNotes } from "./meeting.notes.js";
import { initUSG } from "./meeting.usg.js";
import { initRTC } from "./meeting.rtc.js";
import { initRecord } from "./meeting.record.js";
import { initQoS } from "./meeting.qos.js";
import { initCaliper } from "./meeting.caliper.js";

// Firebase setup
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = rtdb.getDatabase(fbApp);

// Room ID
const roomID = window.location.pathname.split("/").pop();
const roomInfo = document.getElementById("roomInfo");
if (roomInfo) roomInfo.textContent = "Room: " + roomID;

// DOM Elements
const elements = {
    cam0: document.getElementById("camera0"),
    cam1: document.getElementById("camera1"),
    cam2: document.getElementById("camera2"),
    box0: document.getElementById("box0"),
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
    iconOverlay0: document.getElementById("iconOverlay0"),
    camSelect0: document.getElementById("cameraSelect0"),
    micBtn: document.getElementById("toggleMic"),
    camBtn: document.getElementById("toggleCam"),
    leaveBtn: document.getElementById("leaveBtn"),
    btnShareCam: document.getElementById("btnShareCam"),
    btnScreenshot: document.getElementById("btnScreenshot"),
    btnRecord: document.getElementById("btnRecord"),
    chatMessages: document.getElementById("chatMessages"),
    chatText: document.getElementById("chatText"),
    chatSend: document.getElementById("chatSend"),
    chatHeader: document.getElementById("chatHeader"),
    notesWindow: document.getElementById("notesWindow"),
    notesHeader: document.getElementById("notesHeader"),
    notesBtn: document.getElementById("btnNotes"),
    usgModal: document.getElementById("usgModal"),
    usgConfirm: document.getElementById("usgConfirm"),
    usgCancel: document.getElementById("usgCancel"),
    usgCamSelect: document.getElementById("usgCamSelect"),
    usgCanvas: document.getElementById("usgPreview"),
    recordingIndicator: document.getElementById("recordingIndicator"),
    remoteAudio: document.getElementById("remoteAudio"),
};
elements.usgCtx = elements.usgCanvas ? elements.usgCanvas.getContext("2d") : null;

// Shared state
const state = {
    nickname: "User",
    myId: null,
    peerId: null,
    micOn: sessionStorage.getItem("micState") !== "false",
    camOn: sessionStorage.getItem("camState") !== "false",
    selectedCam: sessionStorage.getItem("selectedCamera") || null,
    WS_URL: null,
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
    ],
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
    // Remote
    remoteStreamLatest: null,
    remoteUsgStreamLatest: null,
    remoteCamOn: true,
    remoteMicOn: true,
    remoteUsgSharing: false,
    // Cloudinary config
    cloudinaryConfig: null,
};

// Context object shared between modules
const ctx = {
    firebaseDb: rtdb,
    auth, db, roomID, elements, state,
    ws: null,
    showToast,
};
ctx.usgStateRef = rtdb.ref(db, `rooms/${roomID}/usg`);

// Load server config
async function loadConfig() {
    const resp = await fetch("/config");
    const json = await resp.json();
    state.WS_URL = json.signaling_url;
    state.cloudinaryConfig = json.cloudinary;
}

async function loadIceServers() {
    try {
        const resp = await fetch("/ice");
        const data = await resp.json();
        // Append TURN servers from OpenRelay API (don't overwrite)
        if (data.iceServers && data.iceServers.length) {
            state.iceServers = [...state.iceServers, ...data.iceServers];
        }
    } catch (e) {
        console.warn("Failed to load ICE, using default (OpenRelay) only", e);
    }
}

// Get user nickname
onAuthStateChanged(auth, (user) => {
    if (user) state.nickname = user.displayName || (user.email ? user.email.split("@")[0] : "User");
});

// Initialize modules
const rtc = initRTC(ctx);
ctx.rtc = rtc;
const chat = initChat(ctx);
initNotes(ctx);
const usg = initUSG(ctx);
const caliper = initCaliper();
ctx.caliper = caliper;
const record = initRecord(ctx);
ctx.record = record;
const qos = initQoS(ctx);
ctx.qos = qos;

// Show QoS button for admin (DEV_MODE) users
const isAdmin = sessionStorage.getItem("devMode") === "true";
const btnQoS = document.getElementById("btnQoS");
if (isAdmin && btnQoS) {
    btnQoS.classList.remove("hidden");
}

// Initialize button icons based on saved state
rtc.initButtonIcons();

// Function to update USG-only buttons visibility
function updateUSGButtons() {
    const showButtons = state.usgSharing || state.remoteUsgSharing;
    const usgBtns = document.querySelectorAll(".usg-only-btn");
    usgBtns.forEach(btn => {
        if (showButtons) btn.classList.remove("hidden");
        else btn.classList.add("hidden");
    });
}
ctx.updateUSGButtons = updateUSGButtons;

// USG state listener (Firebase)
rtdb.onValue(ctx.usgStateRef, (snap) => {
    const st = snap.val() || {};
    const wasActive = state.remoteUsgSharing;
    state.remoteUsgSharing = !!st.active && st.owner !== state.myId;

    // Lock button if peer is sharing
    const disabled = (st.active && st.owner && st.owner !== state.myId);
    if (elements.btnShareCam) {
        elements.btnShareCam.disabled = disabled;
        elements.btnShareCam.style.opacity = disabled ? "0.5" : "1";
        elements.btnShareCam.style.pointerEvents = disabled ? "none" : "auto";
        elements.btnShareCam.title = disabled ? "USG sedang dishare oleh lawan bicara" : "Share USG Camera";
    }

    if (!st.active) state.remoteUsgStreamLatest = null;

    updateUSGButtons();
    ctx.applyLayout?.();
});

// UI binds
if (elements.micBtn) elements.micBtn.addEventListener("click", () => rtc.toggleMic());
if (elements.camBtn) elements.camBtn.addEventListener("click", () => rtc.toggleCam());

// Leave meeting
async function cleanupLocal() {
    // Remove from Firebase participants
    const user = auth.currentUser;
    if (user) {
        try {
            await rtdb.remove(rtdb.ref(db, `rooms/${roomID}/participants/${user.uid}`));
        } catch (e) { console.warn("Failed to remove participant", e); }
    }

    // Clear USG state if we were sharing
    if (state.usgSharing) {
        try {
            await rtdb.set(ctx.usgStateRef, { active: false, owner: null, ts: Date.now() });
        } catch (e) { console.warn("Failed to clear USG state", e); }
    }

    try { ctx.ws && ctx.ws.close(); } catch { }
    try { rtc?.pc && rtc.pc.close(); } catch { }
    if (state.localAudio) { try { state.localAudio.getTracks().forEach(t => t.stop()); } catch { } state.localAudio = null; }
    if (state.localVideo) { try { state.localVideo.getTracks().forEach(t => t.stop()); } catch { } state.localVideo = null; }
    try { chat.cleanup(); } catch { }
    try { usg.cleanup(); } catch { }
    try { record.cleanup(); } catch { }
}

if (elements.leaveBtn) {
    elements.leaveBtn.addEventListener("click", async () => {
        if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) ctx.ws.send(JSON.stringify({ action: "leave" }));
        await cleanupLocal();
        window.location.href = "/dashboard";
    });
}

window.addEventListener("beforeunload", () => {
    // Use synchronous XMLHttpRequest for beforeunload
    const user = auth.currentUser;
    if (user) {
        const xhr = new XMLHttpRequest();
        xhr.open("DELETE", `/api/participant/${roomID}/${user.uid}`, false);
        try { xhr.send(); } catch { }
    }
    if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) ctx.ws.send(JSON.stringify({ action: "leave" }));
    // Sync cleanup for tracks
    try { if (state.localAudio) state.localAudio.getTracks().forEach(t => t.stop()); } catch { }
    try { if (state.localVideo) state.localVideo.getTracks().forEach(t => t.stop()); } catch { }
});

// Initialize
(async () => {
    await loadConfig();
    await loadIceServers();
    await rtc.startMic();
    await rtc.loadCamerasMeeting();
    await rtc.loadMicrophones();
    await rtc.connectWS();
    chat.attachChatListener();
    ctx.ws.send(JSON.stringify({ action: "join", room: roomID, uid: null }));
    rtc.applyLayout();
    updateUSGButtons();
})();

// === MEETING.JS – Firebase + WebRTC (Ngrok/Xirsys) — PATCHED ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, set, remove, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ====================== Firebase Config ======================
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

// ====================== DOM ======================
const cam0 = document.getElementById("camera0");        // remote
const cam1 = document.getElementById("camera1");        // local
const placeholder0 = document.getElementById("placeholder0");
const placeholder1 = document.getElementById("placeholder1");
const camSelect0 = document.getElementById("cameraSelect0");
const micBtn = document.getElementById("toggleMic");
const camBtn = document.getElementById("toggleCam");
const leaveBtn = document.getElementById("leaveBtn");
const camOffIcon0 = document.getElementById("camOffIcon0");
const micOffIcon0 = document.getElementById("micOffIcon0");
const camOffIcon1 = document.getElementById("camOffIcon1");
const micOffIcon1 = document.getElementById("micOffIcon1");
const dimmer0 = document.getElementById("dimmer0");

// ====================== State ======================
let selfAudioStream = null;
let selfVideoStream = null;
let micOn = true;
let camOn = true;
let remoteCamOn = true;
let remoteMicOn = true;

let ws = null;
let pc = null;
let isJoinedSignaling = false;
const roomID = window.location.pathname.split("/").pop();

// Perfect negotiation flags (kept but simplified use)
let isMakingOffer = false;
let isPolite = false;
let mySignalId = null;
let remoteSignalId = null;
let pendingRemoteCandidates = [];

// Cache senders (stable)
let aSender = null; // audio sender – DO NOT null/replace with null on camera toggles
let vSender = null; // video sender

// ====================== Signaling URL ======================
let WS_URL = null;
try {
  const resp = await fetch("/config");
  const { signaling_url } = await resp.json();
  WS_URL = signaling_url;
  console.log("✅ Signaling server URL:", WS_URL);
} catch (err) {
  console.error("❌ Gagal memuat /config:", err);
  alert("Tidak bisa memuat konfigurasi server. Pastikan Flask & signaling aktif.");
}

// ====================== RTC Config ======================
const RTC_CONFIG = {
  iceServers: [
    { urls: ["stun:ss-turn2.xirsys.com"] },
    {
      username: "sKXJ-N3SYceFbP40egIYKSolC6jDBVaSSoa7BJViaUOU2jsD-Y8oIwaTn6KdEgS1AAAAAGjhNBNyaXphYXJpYQ==",
      credential: "64747cd6-a131-11f0-b573-0242ac140004",
      urls: [
        "turn:ss-turn2.xirsys.com:80?transport=udp",
        "turn:ss-turn2.xirsys.com:3478?transport=udp",
        "turns:ss-turn2.xirsys.com:443?transport=tcp"
      ]
    }
  ]
};

// ============================================================
// MEDIA
// ============================================================
async function startSelfAudio() {
  if (selfAudioStream) return selfAudioStream;
  try {
    selfAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    selfAudioStream.getAudioTracks().forEach(t => (t.enabled = micOn));

    // attach once if sender exists
    if (pc && aSender) {
      const aTrack = selfAudioStream.getAudioTracks()[0];
      if (aTrack) await aSender.replaceTrack(aTrack);
    }

    // if no video yet, show audio-only preview
    if (!selfVideoStream) {
      const onlyAudio = new MediaStream(selfAudioStream.getTracks());
      cam1.srcObject = onlyAudio;
      cam1.muted = true;
      cam1.style.display = "block";
      placeholder1.style.display = "none";
    }
    return selfAudioStream;
  } catch (e) {
    console.error("Tidak bisa akses mikrofon:", e);
    return null;
  }
}

async function startSelfCamera(deviceId) {
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true
    });
    selfVideoStream = videoStream;

    // Local preview = audio + video (if available)
    const renderStream = selfAudioStream
      ? new MediaStream([...selfAudioStream.getTracks(), ...selfVideoStream.getTracks()])
      : selfVideoStream;

    cam1.srcObject = renderStream;
    cam1.muted = true;
    cam1.style.display = "block";
    placeholder1.style.display = "none";

    // update video sender only (do not touch audio here)
    if (pc && vSender) {
      const vTrack = selfVideoStream.getVideoTracks()[0];
      await vSender.replaceTrack(vTrack || null);
    }
  } catch (err) {
    console.error("Tidak bisa akses kamera:", err);
    placeholder1.textContent = "Tidak dapat mengakses kamera";
    placeholder1.style.display = "flex";
  }
}

function stopSelfCamera() {
  if (selfVideoStream) {
    selfVideoStream.getTracks().forEach(t => t.stop());
    selfVideoStream = null;
  }

  // local preview off (keep audio UI minimal)
  cam1.srcObject = null;
  cam1.style.display = "none";
  camOffIcon1.style.display = "block";

  // detach VIDEO ONLY (never touch audio sender here)
  if (pc && vSender) {
    vSender.replaceTrack(null).catch(() => {});
  }
}

function updateLocalOverlay() {
  // independent overlays
  camOffIcon1.style.display = camOn ? "none" : "block";
  micOffIcon1.style.display = micOn ? "none" : "block";
}

function updateRemoteOverlay() {
  camOffIcon0.style.display = remoteCamOn ? "none" : "block";
  micOffIcon0.style.display = remoteMicOn ? "none" : "block";
  if (dimmer0) dimmer0.style.display = remoteCamOn ? "none" : "block";
}

// ============================================================
// UI TOGGLES
// ============================================================
micBtn.addEventListener("click", async () => {
  if (!selfAudioStream) await startSelfAudio();
  micOn = !micOn;

  if (selfAudioStream) {
    // soft-mute only – keep the same track/sender intact
    selfAudioStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  }
  micBtn.querySelector("img").src = micOn ? "/static/img/Mic.png" : "/static/img/Mic off.png";
  updateLocalOverlay();

  // signal peer
  if (ws && ws.readyState === WebSocket.OPEN && pc && pc._targetId) {
    ws.send(JSON.stringify({ action: "mic-state", target: pc._targetId, state: micOn ? "on" : "off" }));
  }
});

camBtn.addEventListener("click", async () => {
  camOn = !camOn;

  if (!camOn) {
    // turn video off
    stopSelfCamera();
    camBtn.querySelector("img").src = "/static/img/Camera off.png";
    updateLocalOverlay();

    if (ws && ws.readyState === WebSocket.OPEN && pc && pc._targetId) {
      ws.send(JSON.stringify({ action: "camera-state", target: pc._targetId, state: "off" }));
    }
    return;
  }

  // turn video back on
  try {
    const selectedId = camSelect0.value || undefined;
    await startSelfCamera(selectedId);

    // IMPORTANT: ensure audio sender/track stays attached (avoid audio loss)
    if (pc && aSender && selfAudioStream) {
      const aTrack = selfAudioStream.getAudioTracks()[0];
      if (aTrack) {
        await aSender.replaceTrack(aTrack);  // re-affirm audio sender
        aTrack.enabled = micOn;              // respect current mic state
      }
    }

    camBtn.querySelector("img").src = "/static/img/Icon.png";
    updateLocalOverlay();

    if (ws && ws.readyState === WebSocket.OPEN && pc && pc._targetId) {
      ws.send(JSON.stringify({ action: "camera-state", target: pc._targetId, state: "on" }));
    }
  } catch (err) {
    console.error("❌ Gagal menghidupkan kamera:", err);
    camOffIcon1.style.display = "block";
  }
});

camSelect0.addEventListener("change", async (e) => {
  const selectedId = e.target.value;
  if (camOn) {
    // replace video track cleanly
    if (selfVideoStream) selfVideoStream.getTracks().forEach(t => t.stop());
    await startSelfCamera(selectedId);
  }
});

// ============================================================
// SIGNALING
// ============================================================
function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
    ws.onclose = () => console.log("WS closed");
    ws.onmessage = async (evt) => {
      try {
        const data = JSON.parse(evt.data);
        await handleSignaling(data);
      } catch (e) {
        console.warn("Malformed WS message", e);
      }
    };
  });
}

async function handleSignaling(data) {
  const action = data.action;

  if (action === "id") {
    mySignalId = String(data.id);

  } else if (action === "peers") {
    const peers = data.peers || [];
    if (peers.length > 0) {
      remoteSignalId = String(peers[0]);
      await createOffer(remoteSignalId);
    }

  } else if (action === "offer") {
    remoteSignalId = String(data.from);
    await handleOffer(data.from, data.sdp, data.type);

  } else if (action === "answer") {
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
      if (pendingRemoteCandidates.length) {
        for (const c of pendingRemoteCandidates) {
          try { await pc.addIceCandidate(c); } catch {}
        }
        pendingRemoteCandidates = [];
      }
    } catch (e) {
      console.error("setRemoteDescription(answer) error:", e);
    }

  } else if (action === "candidate") {
    if (!pc) return;
    try {
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        pendingRemoteCandidates.push(data.candidate);
      } else {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.warn("addIceCandidate error (buffering):", err);
      pendingRemoteCandidates.push(data.candidate);
    }

  } else if (action === "camera-state") {
    remoteCamOn = data.state === "on";
    updateRemoteOverlay();

  } else if (action === "mic-state") {
    remoteMicOn = data.state === "on";
    updateRemoteOverlay();
  }
}

// ============================================================
// PEER CONNECTION (stable senders)
// ============================================================
async function createPeerConnection(targetId) {
  if (pc) pc.close();

  pc = new RTCPeerConnection(RTC_CONFIG);
  pc._targetId = targetId;

  // polite: id lebih besar → polite (deterministic)
  isPolite = (parseInt(mySignalId || "0", 10) > parseInt(String(targetId), 10));

  pc.onicecandidate = (evt) => {
    if (evt.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "candidate", target: targetId, candidate: evt.candidate }));
    }
  };

  pc.ontrack = (evt) => {
    let stream = evt.streams && evt.streams[0];
    if (!stream) {
      // edge case assemble
      stream = cam0.srcObject instanceof MediaStream ? cam0.srcObject : new MediaStream();
      stream.addTrack(evt.track);
    }
    cam0.srcObject = stream;
    cam0.autoplay = true;
    cam0.playsInline = true;
    placeholder0.style.display = "none";
    cam0.style.display = "block";

    // honor current remote overlay states
    updateRemoteOverlay();
    console.log("✅ Remote track received");
  };

  pc.onnegotiationneeded = async () => {
    try {
      isMakingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ action: "offer", target: targetId, sdp: offer.sdp, type: offer.type }));
    } catch (e) {
      console.error("onnegotiationneeded error:", e);
    } finally {
      isMakingOffer = false;
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("PC state:", pc.connectionState);
  };

  // Create stable transceivers and cache senders
  const aTrans = pc.addTransceiver("audio", { direction: "sendrecv" });
  const vTrans = pc.addTransceiver("video", { direction: "sendrecv" });
  aSender = aTrans.sender;
  vSender = vTrans.sender;

  // Attach current tracks if present
  if (selfAudioStream?.getAudioTracks()[0]) {
    await aSender.replaceTrack(selfAudioStream.getAudioTracks()[0]);
    selfAudioStream.getAudioTracks()[0].enabled = micOn;
  }
  if (selfVideoStream?.getVideoTracks()[0]) {
    await vSender.replaceTrack(selfVideoStream.getVideoTracks()[0]);
  }
}

async function createOffer(targetId) {
  await createPeerConnection(targetId);
  // offer is sent by negotiationneeded
}

async function handleOffer(fromId, sdp, type) {
  if (!pc || pc._targetId !== fromId) {
    await createPeerConnection(fromId);
  }

  const offer = { type, sdp };
  const readyForOffer = !isMakingOffer && (pc.signalingState === "stable" || isPolite);
  const offerCollision = !readyForOffer;

  if (!isPolite && offerCollision) {
    console.warn("Ignoring offer (impolite during glare).");
    return;
  }

  try {
    if (offerCollision) {
      await Promise.all([
        pc.setLocalDescription({ type: "rollback" }),
        pc.setRemoteDescription(offer)
      ]);
    } else {
      await pc.setRemoteDescription(offer);
    }

    if (pendingRemoteCandidates.length) {
      for (const c of pendingRemoteCandidates) {
        try { await pc.addIceCandidate(c); } catch {}
      }
      pendingRemoteCandidates = [];
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ action: "answer", target: fromId, sdp: answer.sdp, type: answer.type }));
  } catch (e) {
    console.error("handleOffer error:", e);
  }
}

// ============================================================
// JOIN / LEAVE
// ============================================================
async function webrtcJoin() {
  if (isJoinedSignaling) return;
  await ensureWs();
  if (!selfAudioStream) await startSelfAudio();
  if (camOn && !selfVideoStream) await startSelfCamera(camSelect0.value || undefined);
  ws.send(JSON.stringify({ action: "join", room: roomID }));
  isJoinedSignaling = true;
}

function webrtcLeave() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "leave" }));
    ws.close();
  }
  if (pc) { pc.close(); pc = null; }

  cam0.pause?.();
  cam0.srcObject = null;
  cam0.load?.();
  cam0.style.display = "none";
  placeholder0.textContent = "Menunggu lawan bicara...";
  placeholder0.style.display = "flex";
  if (dimmer0) dimmer0.style.display = "none";
  camOffIcon0.style.display = "none";
  micOffIcon0.style.display = "none";

  if (selfVideoStream) { selfVideoStream.getTracks().forEach(t => t.stop()); selfVideoStream = null; }
  if (selfAudioStream) { selfAudioStream.getTracks().forEach(t => t.stop()); selfAudioStream = null; }

  console.log("👋 Left room and reset UI");
}

// ============================================================
// Firebase participants
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/login";
    return;
  }

  try {
    const pRef = ref(db, `meetings/${roomID}/participants`);
    const snap = await get(pRef);
    const current = snap.exists() ? Object.keys(snap.val()) : [];
    if (current.length >= 2 && !current.includes(user.uid)) {
      alert("Room sudah penuh, tidak bisa bergabung.");
      window.location.href = "/dashboard";
      return;
    }

    await set(ref(db, `meetings/${roomID}/participants/${user.uid}`), user.email);
    await webrtcJoin();

    onChildRemoved(pRef, (snapshot) => {
      const leftUser = snapshot.key;
      if (leftUser !== user.uid) {
        console.log("👋 Lawan bicara meninggalkan room.");
        cam0.pause?.();
        cam0.srcObject = null;
        cam0.load?.();
        cam0.style.display = "none";
        placeholder0.textContent = "Menunggu lawan bicara...";
        placeholder0.style.display = "flex";
        if (dimmer0) dimmer0.style.display = "none";
        camOffIcon0.style.display = "none";
        micOffIcon0.style.display = "none";
        remoteCamOn = true;
        remoteMicOn = true;
      }
    });

  } catch (err) {
    console.error("❌ Gagal join room:", err);
  }
});

// ============================================================
// Leave
// ============================================================
leaveBtn.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) { window.location.href = "/dashboard"; return; }

  stopSelfCamera();
  if (selfAudioStream) {
    selfAudioStream.getTracks().forEach(t => t.stop());
    selfAudioStream = null;
  }
  webrtcLeave();

  try {
    await remove(ref(db, `meetings/${roomID}/participants/${user.uid}`));
    const checkRef = ref(db, `meetings/${roomID}/participants`);
    const snap = await get(checkRef);
    if (!snap.exists() || Object.keys(snap.val() || {}).length === 0) {
      await remove(ref(db, `meetings/${roomID}`));
    }
  } catch (e) {
    console.error("❌ Gagal cleanup:", e);
  } finally {
    setTimeout(() => (window.location.href = "/dashboard"), 300);
  }
});

// ============================================================
// Init
// ============================================================
async function loadCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === "videoinput");
  camSelect0.innerHTML = "";
  cams.forEach((cam, idx) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Kamera ${idx}`;
    camSelect0.appendChild(opt);
  });

  await startSelfAudio();
  if (cams.length > 0) await startSelfCamera(cams[0].deviceId);

  // initial remote UI (clean, not dimmed)
  if (dimmer0) dimmer0.style.display = "none";
  camOffIcon0.style.display = "none";
  micOffIcon0.style.display = "none";
  cam0.style.display = "none";
  placeholder0.textContent = "Menunggu lawan bicara...";
  placeholder0.style.display = "flex";
}

(async () => {
  await loadCameras();
  updateLocalOverlay();
  updateRemoteOverlay();
})();

window.addEventListener("beforeunload", () => {
  try { webrtcLeave(); } catch {}
  try { if (selfVideoStream) selfVideoStream.getTracks().forEach(t => t.stop()); } catch {}
  try { if (selfAudioStream) selfAudioStream.getTracks().forEach(t => t.stop()); } catch {}
});

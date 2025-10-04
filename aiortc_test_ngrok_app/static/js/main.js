// static/js/main.js (final version with TURN via Xirsys)
const logEl = document.getElementById("log");
function log(...args) {
  console.log(...args);
  if (logEl) logEl.textContent += args.join(" ") + "\n";
}

let ws = null;
let pc = null;
let localStream = null;
let isJoined = false;
let room = null;

// ✅ Gunakan STUN/TURN dari Xirsys agar bisa konek lintas jaringan
const configuration = {
  iceServers: [
    { urls: [ "stun:ss-turn2.xirsys.com" ] },
    {
      username: "sKXJ-N3SYceFbP40egIYKSolC6jDBVaSSoa7BJViaUOU2jsD-Y8oIwaTn6KdEgS1AAAAAGjhNBNyaXphYXJpYQ==",
      credential: "64747cd6-a131-11f0-b573-0242ac140004",
      urls: [
        "turn:ss-turn2.xirsys.com:80?transport=udp",
        "turn:ss-turn2.xirsys.com:3478?transport=udp",
        "turn:ss-turn2.xirsys.com:80?transport=tcp",
        "turn:ss-turn2.xirsys.com:3478?transport=tcp",
        "turns:ss-turn2.xirsys.com:443?transport=tcp",
        "turns:ss-turn2.xirsys.com:5349?transport=tcp"
      ]
    }
  ]
};

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    const cameraSelect = document.getElementById("cameraSelect");
    if (!cameraSelect) {
      log("ERROR: #cameraSelect not found in DOM");
      return;
    }
    cameraSelect.innerHTML = "";
    cams.forEach((cam, idx) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.text = cam.label || `Camera ${idx + 1}`;
      cameraSelect.appendChild(opt);
    });
    if (cameraSelect.options.length === 0) {
      const opt = document.createElement("option");
      opt.text = "No camera";
      cameraSelect.appendChild(opt);
    }
    log("Cameras listed:", cameraSelect.options.length);
  } catch (err) {
    log("Error listing devices:", err);
  }
}

async function startLocalStream(deviceId) {
  try {
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: true
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      try { await localVideo.play(); } catch (e) { /* ignore autoplay error */ }
    }
    log("Local stream started (tracks):", localStream.getTracks().map(t=>t.kind).join(","));
  } catch (err) {
    log("getUserMedia error:", err);
    throw err;
  }
}

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    try {
      ws = new WebSocket(proto + "://" + location.host + "/ws");
    } catch (e) {
      log("WebSocket constructor error:", e);
      return reject(e);
    }
    ws.onopen = () => { log("WS open"); resolve(); };
    ws.onerror = (e) => { log("WS error", e); reject(e); };
    ws.onmessage = async (evt) => {
      try {
        const data = JSON.parse(evt.data);
        await handleSignaling(data);
      } catch (e) {
        log("Malformed WS message:", e);
      }
    };
    ws.onclose = () => log("WS closed");
  });
}

async function handleSignaling(data) {
  const action = data.action;
  if (action === "id") {
    log("Assigned id:", data.id);
  } else if (action === "peers") {
    const peers = data.peers || [];
    log("Peers in room:", peers);
    if (peers.length > 0) {
      const target = peers[0];
      setTimeout(() => createOffer(target).catch(e => log("createOffer err:", e)), 300);
    }
  } else if (action === "offer") {
    log("Received offer from", data.from);
    await handleOffer(data.from, data.sdp, data.type);
  } else if (action === "answer") {
    log("Received answer from", data.from);
    if (!pc) { log("No pc when answer arrived"); return; }
    await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
    log("Remote description (answer) set");
  } else if (action === "candidate") {
    if (!pc) { log("No pc to add candidate"); return; }
    try {
      await pc.addIceCandidate(data.candidate);
      log("Added remote ICE candidate");
    } catch (err) {
      log("addIceCandidate error:", err);
    }
  } else if (action === "peer-leave") {
    log("Peer left:", data.id);
    if (pc) { pc.close(); pc = null; }
    const remoteVideo = document.getElementById("remoteVideo");
    if (remoteVideo) remoteVideo.srcObject = null;
  } else if (action === "peer-join") {
    log("Peer joined:", data.id);
  } else {
    log("Unknown signaling action:", action);
  }
}

function setupPcHandlers(targetId) {
  if (!pc) return;
  pc.onicecandidate = (evt) => {
    if (evt.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "candidate", target: targetId, candidate: evt.candidate }));
      log("Sent local ICE candidate:", evt.candidate && evt.candidate.candidate ? evt.candidate.candidate.substring(0,60) + "..." : evt.candidate);
    }
  };
  pc.oniceconnectionstatechange = () => {
    log("ICE state:", pc.iceConnectionState, "conn state:", pc.connectionState);
  };
  pc.onconnectionstatechange = () => {
    log("PC connectionState:", pc.connectionState);
  };
  pc.ontrack = (evt) => {
    const remoteVideo = document.getElementById("remoteVideo");
    log("ontrack event: streams:", evt.streams.length, "tracks:", evt.streams[0] ? evt.streams[0].getTracks().map(t=>t.kind) : []);
    if (remoteVideo) {
      remoteVideo.srcObject = evt.streams[0];
      remoteVideo.play().then(() => {
        log("Remote video play succeeded");
      }).catch((err) => {
        log("Remote video play failed (autoplay?):", err);
      });
    }
  };
}

async function createPeerConnection(targetId) {
  pc = new RTCPeerConnection(configuration);
  setupPcHandlers(targetId);

  if (localStream) {
    localStream.getTracks().forEach(t => {
      pc.addTrack(t, localStream);
      log("Added local track to pc:", t.kind);
    });
  } else {
    log("Warning: localStream is null when creating PC");
  }
  return pc;
}

async function createOffer(targetId) {
  if (pc) {
    log("Warning: pc already exists; closing and recreating");
    pc.close();
    pc = null;
  }
  await createPeerConnection(targetId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ action: "offer", target: targetId, sdp: offer.sdp, type: offer.type }));
  log("Offer sent");
}

async function handleOffer(fromId, sdp, type) {
  if (pc) {
    log("Warning: pc exists when handling offer; closing and recreating");
    pc.close();
    pc = null;
  }
  await createPeerConnection(fromId);
  await pc.setRemoteDescription({ type: type, sdp: sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ws.send(JSON.stringify({ action: "answer", target: fromId, sdp: answer.sdp, type: answer.type }));
  log("Answer sent");
}

async function joinRoom() {
  if (isJoined) return;

  const roomInput = document.getElementById("room");
  const cameraSelect = document.getElementById("cameraSelect");
  const joinBtn = document.getElementById("joinBtn");
  const leaveBtn = document.getElementById("leaveBtn");

  if (!roomInput) { log("ERROR: #room element missing"); alert("Internal error: room input not found"); return; }
  if (!cameraSelect) { log("ERROR: #cameraSelect element missing"); alert("Internal error: camera select not found"); return; }

  room = (roomInput.value || "").trim() || "default";

  try {
    await ensureWs();
  } catch (err) {
    log("WS connect failed:", err);
    alert("Signaling server unreachable");
    return;
  }

  const deviceId = cameraSelect.value || null;
  try {
    await startLocalStream(deviceId);
  } catch (err) {
    log("getUserMedia failed:", err);
    alert("Tidak dapat mengakses kamera/mikrofon");
    return;
  }

  ws.send(JSON.stringify({ action: "join", room }));
  isJoined = true;
  if (joinBtn) joinBtn.disabled = true;
  if (leaveBtn) leaveBtn.disabled = false;
  log("Joined room:", room);
}

function leaveRoom() {
  if (!isJoined) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "leave" }));
    ws.close();
  }
  if (pc) { pc.close(); pc = null; }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  isJoined = false;
  const joinBtn = document.getElementById("joinBtn");
  const leaveBtn = document.getElementById("leaveBtn");
  if (joinBtn) joinBtn.disabled = false;
  if (leaveBtn) leaveBtn.disabled = true;
  log("Left room");
}

window.addEventListener("DOMContentLoaded", async () => {
  const refreshCamsBtn = document.getElementById("refreshCams");
  const joinBtn = document.getElementById("joinBtn");
  const leaveBtn = document.getElementById("leaveBtn");

  if (!document.getElementById("room") || !document.getElementById("cameraSelect") ||
      !document.getElementById("localVideo") || !document.getElementById("remoteVideo")) {
    log("ERROR: one or more UI elements missing. Ensure index.html contains #room, #cameraSelect, #localVideo, #remoteVideo.");
    return;
  }

  if (joinBtn) joinBtn.disabled = true;

  try {
    await listCameras();
  } catch (e) {
    log("enumerateDevices err", e);
  } finally {
    if (joinBtn) joinBtn.disabled = false;
  }

  if (refreshCamsBtn) refreshCamsBtn.addEventListener("click", listCameras);
  if (joinBtn) joinBtn.addEventListener("click", joinRoom);
  if (leaveBtn) leaveBtn.addEventListener("click", leaveRoom);

  log("UI ready");
});

window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
});

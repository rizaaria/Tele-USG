// main.js
const logEl = document.getElementById("log");
const log = (...args) => {
  console.log(...args);
  if (logEl) logEl.textContent += args.join(" ") + "\n";
};

const localVideo = document.getElementById("localVideo");
const remotesEl = document.getElementById("remotes");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");

let ws = null;
let clientId = null;
let room = null;
let localStream = null;
const peerConnections = {}; // targetId -> RTCPeerConnection

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // add TURN server here if needed
  ]
};

async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    log("Got local stream");
  } catch (err) {
    alert("Could not get local media: " + err);
    throw err;
  }
}

function createRemoteVideo(id) {
  let container = document.createElement("div");
  container.className = "video-box";
  container.id = `peer-${id}`;
  container.innerHTML = `<h3>Peer ${id}</h3><video id="video-${id}" autoplay playsinline></video>`;
  remotesEl.appendChild(container);
  return container.querySelector("video");
}

function removeRemoteVideo(id) {
  const el = document.getElementById(`peer-${id}`);
  if (el) el.remove();
}

function setupWebSocket(serverUrl) {
  ws = new WebSocket(serverUrl);

  ws.addEventListener("open", () => {
    log("WebSocket open");
  });

  ws.addEventListener("message", async (evt) => {
    const data = JSON.parse(evt.data);
    const action = data.action;
    if (action === "id") {
      clientId = data.id;
      log("Assigned client id:", clientId);
    } else if (action === "peers") {
      const peers = data.peers || [];
      log("Existing peers in room:", peers);
      // create offer to each existing peer
      for (const peerId of peers) {
        await createOffer(peerId);
      }
    } else if (action === "peer-join") {
      const newPeer = data.id;
      log("Peer joined:", newPeer);
      // The new peer will create offer to us (or we can create), but we'll wait.
    } else if (action === "offer") {
      const from = data.from;
      log("Received offer from", from);
      await handleOffer(from, data.sdp, data.type);
    } else if (action === "answer") {
      const from = data.from;
      log("Received answer from", from);
      await handleAnswer(from, data.sdp, data.type);
    } else if (action === "candidate") {
      const from = data.from;
      const cand = data.candidate;
      log("Received candidate from", from, cand && cand.candidate);
      await handleCandidate(from, cand);
    } else if (action === "peer-leave") {
      const id = data.id;
      log("Peer left:", id);
      if (peerConnections[id]) {
        peerConnections[id].close();
        delete peerConnections[id];
      }
      removeRemoteVideo(id);
    } else {
      log("Unknown WS message:", data);
    }
  });

  ws.addEventListener("close", () => {
    log("WebSocket closed");
  });

  ws.addEventListener("error", (e) => {
    log("WebSocket error", e);
  });
}

async function createPeerConnection(targetId) {
  log("Creating PC for", targetId);
  const pc = new RTCPeerConnection(configuration);

  // add local tracks
  if (localStream) {
    for (const t of localStream.getTracks()) {
      pc.addTrack(t, localStream);
    }
  }

  // remote track handling
  const remoteVideo = createRemoteVideo(targetId);
  pc.ontrack = (evt) => {
    log("ontrack for", targetId, evt.streams);
    remoteVideo.srcObject = evt.streams[0];
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      // send candidate to peer
      ws.send(JSON.stringify({
        action: "candidate",
        target: targetId,
        candidate: evt.candidate
      }));
      log("Sent candidate to", targetId, evt.candidate.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    log("PC", targetId, "state:", pc.connectionState);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      // cleanup
      if (peerConnections[targetId]) {
        peerConnections[targetId].close();
        delete peerConnections[targetId];
      }
      removeRemoteVideo(targetId);
    }
  };

  peerConnections[targetId] = pc;
  return pc;
}

async function createOffer(targetId) {
  const pc = await createPeerConnection(targetId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // send offer
  ws.send(JSON.stringify({
    action: "offer",
    target: targetId,
    sdp: pc.localDescription.sdp,
    type: pc.localDescription.type
  }));
  log("Sent offer to", targetId);
}

async function handleOffer(fromId, sdp, type) {
  const pc = await createPeerConnection(fromId);
  await pc.setRemoteDescription({ type: type, sdp: sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  // send answer
  ws.send(JSON.stringify({
    action: "answer",
    target: fromId,
    sdp: pc.localDescription.sdp,
    type: pc.localDescription.type
  }));
  log("Sent answer to", fromId);
}

async function handleAnswer(fromId, sdp, type) {
  const pc = peerConnections[fromId];
  if (!pc) {
    log("No pc for", fromId);
    return;
  }
  await pc.setRemoteDescription({ type: type, sdp: sdp });
  log("Set remote desc for", fromId);
}

async function handleCandidate(fromId, candidateObj) {
  const pc = peerConnections[fromId];
  if (!pc) {
    log("No pc for", fromId, "— buffering candidate not implemented");
    return;
  }
  try {
    await pc.addIceCandidate(candidateObj);
    log("Added candidate from", fromId);
  } catch (err) {
    log("Error adding candidate:", err);
  }
}

async function joinRoom() {
  room = document.getElementById("room").value || "default";
  const name = document.getElementById("name").value || "";
  // open ws
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setupWebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/ws");
    // wait for ws to open
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        if (Date.now() - start > 3000) return reject("WebSocket timeout");
        setTimeout(check, 50);
      };
      check();
    });
  }

  // get local media
  await startLocalStream();

  // tell server we join
  ws.send(JSON.stringify({ action: "join", room: room, name: name }));

  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  log("Joined room:", room);
}

function leaveRoom() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "leave" }));
    ws.close();
  }
  // close pcs
  for (const id in peerConnections) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  // remove remote videos
  remotesEl.innerHTML = "";
  if (localStream) {
    for (const t of localStream.getTracks()) t.stop();
    localStream = null;
    localVideo.srcObject = null;
  }
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  log("Left room");
}

joinBtn.addEventListener("click", () => {
  joinRoom().catch(err => {
    log("Join failed:", err);
    joinBtn.disabled = false;
  });
});
leaveBtn.addEventListener("click", leaveRoom);

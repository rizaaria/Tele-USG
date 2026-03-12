// meeting.rtc.js - WebRTC signaling and peer connection
export function initRTC(ctx) {
    const { elements, state } = ctx;
    const { cam0, cam1, cam2, box0, box2, placeholder0, placeholder1, placeholder2,
        camOffIcon0, camOffIcon1, camOffIcon2,
        micOffIcon0, micOffIcon1, micOffIcon2,
        dimmer0 } = elements;
    const micSelect = document.getElementById("micSelect");

    function showVideoEl(el) { if (!el) return; el.style.display = "block"; el.classList.add("play"); }
    function hideVideoEl(el) { if (!el) return; el.style.display = "none"; el.classList.remove("play"); }

    function setWaitingUIForSlot(slot) {
        if (slot === 0) {
            hideVideoEl(cam0);
            // Clear stream source and reset backgrounds to default
            if (cam0) { cam0.srcObject = null; cam0.style.background = ""; }
            if (box0) { box0.style.background = ""; box0.classList.remove("usg-active"); }
            if (placeholder0) { placeholder0.style.display = "flex"; placeholder0.textContent = "Menunggu lawan bicara..."; }
            if (camOffIcon0) camOffIcon0.style.display = "none";
            if (micOffIcon0) micOffIcon0.style.display = "none";
            if (dimmer0) dimmer0.style.display = "none";
        } else {
            if (box2) box2.classList.add("hidden");
            hideVideoEl(cam2);
            if (placeholder2) { placeholder2.style.display = "flex"; placeholder2.textContent = ""; }
            if (camOffIcon2) camOffIcon2.style.display = "none";
            if (micOffIcon2) micOffIcon2.style.display = "none";
        }
    }

    ctx._ui = { showVideoEl, hideVideoEl, setWaitingUIForSlot };

    // Local media
    async function startMic(deviceId = null) {
        // Stop existing audio tracks
        if (state.localAudio) {
            state.localAudio.getTracks().forEach(t => t.stop());
            state.localAudio = null;
        }

        const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
        state.localAudio = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        state.localAudio.getAudioTracks().forEach(t => t.enabled = state.micOn);
        rebuildLocalStream();

        // Replace audio track in peer connection if exists
        if (pc && state.audioSender) {
            const a = state.localAudio.getAudioTracks()[0];
            if (a) await state.audioSender.replaceTrack(a).catch(() => { });
        } else if (pc && !state.audioSender) {
            const a = state.localAudio.getAudioTracks()[0];
            if (a) state.audioSender = pc.addTrack(a, state.localStream || new MediaStream([a]));
        }
    }

    async function startCamera(deviceId) {
        try {
            // Stop old video tracks first
            if (state.localVideo) {
                state.localVideo.getTracks().forEach(t => t.stop());
                state.localVideo = null;
            }

            // Build video constraints - keep native aspect ratio
            const videoConstraints = {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            };
            if (deviceId) videoConstraints.deviceId = { exact: deviceId };

            state.localVideo = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
            state.localVideo.getVideoTracks().forEach(t => t.enabled = state.camOn);
            rebuildLocalStream();
            updateLocalVideoUI();
        } catch (e) {
            console.error("startCamera error", e);
            state.localVideo = null;
            rebuildLocalStream();
            updateLocalVideoUI();
        }
    }

    function rebuildLocalStream() {
        const tracks = [];
        if (state.localAudio) state.localAudio.getAudioTracks().forEach(t => { t.enabled = state.micOn; tracks.push(t); });
        if (state.localVideo) state.localVideo.getVideoTracks().forEach(t => { t.enabled = state.camOn; tracks.push(t); });
        state.localStream = new MediaStream(tracks);
        if (cam1) { cam1.srcObject = state.localStream; cam1.muted = true; }
    }

    function updateLocalVideoUI() {
        const live = state.camOn && state.localVideo && state.localVideo.getVideoTracks().some(t => t.readyState === "live");
        if (live) {
            showVideoEl(cam1);
            if (placeholder1) placeholder1.style.display = "none";
            if (camOffIcon1) camOffIcon1.style.display = "none";
        } else {
            hideVideoEl(cam1);
            if (placeholder1) placeholder1.style.display = "flex";
            if (camOffIcon1) camOffIcon1.style.display = "block";
        }
        // Also update mic icon based on current state
        if (micOffIcon1) micOffIcon1.style.display = state.micOn ? "none" : "block";
    }

    async function restartCameraOnly() {
        if (state.localVideo) state.localVideo.getTracks().forEach(t => t.stop());
        await startCamera(state.selectedCam || null);
        const v = state.localVideo?.getVideoTracks?.()?.[0] || null;
        if (pc && v) {
            if (state.videoSender) {
                // Replace existing track
                await state.videoSender.replaceTrack(v).catch(() => { });
            } else {
                // Add new track (camera was off when joining)
                state.videoSender = pc.addTrack(v, state.localStream || new MediaStream([v]));
            }
            await forceRenegotiate().catch(() => { });
        }
        updateLocalVideoUI();
    }

    // Peer connection
    let pc = null;

    function createPeerIfNeeded() {
        if (pc) return;
        pc = new RTCPeerConnection({ iceServers: state.iceServers });

        pc.onicecandidate = (e) => {
            if (e.candidate && ctx.ws && state.peerId) {
                ctx.ws.send(JSON.stringify({ action: "candidate", target: state.peerId, candidate: e.candidate }));
            }
        };

        pc.onnegotiationneeded = async () => {
            try { await doOffer(); } catch (e) { console.error("negotiationneeded", e); }
        };

        // Monitor connection state for failures
        pc.onconnectionstatechange = () => {
            console.log("Connection state:", pc.connectionState);

            // Start QoS collection when connected
            if (pc.connectionState === "connected") {
                ctx.qos?.startCollecting();
            }

            // Stop QoS collection when disconnected/failed
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
                ctx.qos?.stopCollecting();
            }

            if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
                console.log("Peer connection failed/disconnected, may need ICE restart");
                // Attempt ICE restart on failure
                if (pc.connectionState === "failed" && state.peerId && ctx.ws?.readyState === WebSocket.OPEN) {
                    console.log("Attempting ICE restart...");
                    pc.createOffer({ iceRestart: true }).then(offer => {
                        return pc.setLocalDescription(offer);
                    }).then(() => {
                        ctx.ws.send(JSON.stringify({
                            action: "offer",
                            target: state.peerId,
                            sdp: pc.localDescription.sdp,
                            type: "offer"
                        }));
                    }).catch(e => console.error("ICE restart failed:", e));
                }
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log("ICE connection state:", pc.iceConnectionState);
        };

        // Track routing - simpler approach like TeleUSGv5
        const seen = new Set();
        pc.ontrack = (evt) => {
            const track = evt.track;
            const stream = evt.streams?.[0] || new MediaStream([track]);

            // Handle audio tracks - ALWAYS play audio immediately through dedicated audio element
            if (track && track.kind === "audio") {
                console.log("ontrack received audio track:", track.id);

                // Create a stream with just the audio and play it through the hidden audio element
                const audioStream = new MediaStream([track]);
                if (elements.remoteAudio) {
                    elements.remoteAudio.srcObject = audioStream;
                    elements.remoteAudio.play().catch(e => console.warn("Audio autoplay failed:", e));
                    console.log("Playing remote audio through dedicated audio element");
                }

                // Also add audio to existing remote stream if it exists (for video element playback)
                if (state.remoteStreamLatest) {
                    const existingAudio = state.remoteStreamLatest.getAudioTracks();
                    if (existingAudio.length === 0) {
                        state.remoteStreamLatest.addTrack(track);
                        console.log("Added audio track to remoteStreamLatest");
                    }
                    applyLayout();
                } else {
                    // Store audio track for later attachment when video arrives
                    state.remoteAudioTrack = track;
                    console.log("Stored audio track for later");
                }
                return;
            }

            if (!track || track.kind !== "video") return;
            if (seen.has(track.id)) return;
            seen.add(track.id);

            console.log("ontrack received video track:", track.id, "remoteUsgSharing:", state.remoteUsgSharing, "remoteStreamLatest:", !!state.remoteStreamLatest, "remoteUsgStreamLatest:", !!state.remoteUsgStreamLatest);

            // If remoteUsgSharing is already true when we join
            // First track = USG (shows in camera0), Second track = camera (shows in camera2)
            if (state.remoteUsgSharing) {
                if (!state.remoteUsgStreamLatest) {
                    // First track when USG is active - this is the USG stream
                    state.remoteUsgStreamLatest = new MediaStream([track]);
                    console.log("Assigned as remote USG stream (first track when USG active)");
                    applyLayout();
                    track.onended = () => { state.remoteUsgStreamLatest = null; applyLayout(); };
                    return;
                }
                // Second track - this is the camera stream
                state.remoteStreamLatest = stream;
                console.log("Assigned as remote camera stream (second track when USG active)");
                applyLayout();
                track.onended = () => { state.remoteStreamLatest = null; applyLayout(); };
                return;
            }

            // Normal mode - First video => remote camera
            if (!state.remoteStreamLatest) {
                state.remoteStreamLatest = stream;
                // Attach any pending audio track
                if (state.remoteAudioTrack) {
                    state.remoteStreamLatest.addTrack(state.remoteAudioTrack);
                    console.log("Attached pending audio track to remoteStreamLatest");
                    state.remoteAudioTrack = null;
                }
                console.log("Assigned as remote camera stream");
                applyLayout();
                track.onended = () => { state.remoteStreamLatest = null; applyLayout(); };
                return;
            }

            // Second video => store as pending USG stream
            // It will be shown in layout only if remoteUsgSharing is true (from WebSocket usg-state or Firebase)
            state.remoteUsgStreamLatest = new MediaStream([track]);
            console.log("Stored pending USG stream, remoteUsgSharing:", state.remoteUsgSharing);
            applyLayout();  // This will show it if remoteUsgSharing is already true
            track.onended = () => { state.remoteUsgStreamLatest = null; applyLayout(); };
        };
    }

    async function doOffer() {
        if (!pc || !state.peerId || !ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ctx.ws.send(JSON.stringify({ action: "offer", target: state.peerId, sdp: offer.sdp, type: "offer" }));
        } catch (e) {
            console.warn("doOffer failed:", e);
        }
    }

    async function forceRenegotiate() {
        if (!pc || !state.peerId || !ctx.ws) return;
        try {
            // Use iceRestart to maintain proper m-line ordering
            const offer = await pc.createOffer({ iceRestart: false });
            await pc.setLocalDescription(offer);
            ctx.ws.send(JSON.stringify({ action: "offer", target: state.peerId, sdp: offer.sdp, type: "offer" }));
        } catch (e) {
            console.warn("forceRenegotiate failed:", e);
        }
    }

    // Expose pc, forceRenegotiate, and createPeerIfNeeded to ctx.rtc
    ctx.rtc = { get pc() { return pc; }, forceRenegotiate, createPeerIfNeeded };

    async function handleOffer(data) {
        createPeerIfNeeded();
        await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ctx.ws.send(JSON.stringify({ action: "answer", target: data.from, sdp: answer.sdp, type: "answer" }));
    }

    function attachLocalTracksIfAny() {
        createPeerIfNeeded();

        // Check if audio sender already exists
        if (state.localAudio && !state.audioSender) {
            const a = state.localAudio.getAudioTracks()[0];
            if (a) {
                state.audioSender = pc.addTrack(a, state.localStream || new MediaStream([a]));
            }
        }

        // Ensure we have a video transceiver even when camera is off
        // This helps with proper SDP negotiation for audio-only connections
        if (!state.videoSender && !state.camOn) {
            const existingVideoTransceivers = pc.getTransceivers().filter(t =>
                t.receiver.track?.kind === 'video' || t.sender.track?.kind === 'video'
            );
            if (existingVideoTransceivers.length === 0) {
                pc.addTransceiver('video', { direction: 'recvonly' });
            }
        }

        // Check if video sender already exists
        if (state.localVideo && state.camOn && !state.videoSender) {
            const v = state.localVideo.getVideoTracks()[0];
            if (v) {
                state.videoSender = pc.addTrack(v, state.localStream || new MediaStream([v]));
            }
        }

        // Check if USG sender already exists
        if (state.usgSharing && state.usgStream && !state.usgSender) {
            const u = state.usgStream.getVideoTracks()[0];
            if (u) {
                state.usgSender = pc.addTrack(u, state.usgStream);
            }
        }
    }

    // Layout logic - simplified
    function isShareLayout() {
        return Boolean(state.usgSharing || state.remoteUsgSharing);
    }

    function applyLayout() {
        const share = isShareLayout();

        // Reset icons
        if (camOffIcon0) camOffIcon0.style.display = "none";
        if (micOffIcon0) micOffIcon0.style.display = "none";
        if (camOffIcon2) camOffIcon2.style.display = "none";
        if (micOffIcon2) micOffIcon2.style.display = "none";

        if (!state.peerId) {
            // If sharing USG without peer, still show USG on camera0
            if (share && state.usgSharing && state.usgStream) {
                cam0.srcObject = state.usgStream;
                if (box0) box0.classList.add("usg-active");
                showVideoEl(cam0);
                if (placeholder0) placeholder0.style.display = "none";
                if (box2) box2.classList.remove("hidden");
                hideVideoEl(cam2);
                if (placeholder2) { placeholder2.style.display = "flex"; placeholder2.textContent = "Menunggu lawan bicara..."; }
                ctx.updateUSGButtons?.();
                return;
            }
            setWaitingUIForSlot(0);
            if (box2) box2.classList.add("hidden");
            return;
        }

        if (share) {
            // Main = USG, Side = remote camera
            if (state.usgSharing && state.usgStream) {
                cam0.srcObject = state.usgStream;
                if (box0) box0.classList.add("usg-active");
                showVideoEl(cam0);
                if (placeholder0) placeholder0.style.display = "none";
            } else if (state.remoteUsgStreamLatest) {
                cam0.srcObject = state.remoteUsgStreamLatest;
                if (box0) box0.classList.add("usg-active");
                showVideoEl(cam0);
                if (placeholder0) placeholder0.style.display = "none";
            } else {
                hideVideoEl(cam0);
                if (box0) box0.classList.remove("usg-active");
                if (placeholder0) { placeholder0.style.display = "flex"; placeholder0.textContent = "Mengirim USG..."; }
            }

            // Show remote camera in box2
            if (box2) box2.classList.remove("hidden");
            cam2.srcObject = state.remoteStreamLatest || null;
            if (state.remoteStreamLatest && state.remoteCamOn) {
                showVideoEl(cam2);
                if (placeholder2) placeholder2.style.display = "none";
            } else {
                hideVideoEl(cam2);
                if (placeholder2) { placeholder2.style.display = "flex"; placeholder2.textContent = ""; }
            }

            if (camOffIcon2) camOffIcon2.style.display = state.remoteCamOn ? "none" : "block";
            if (micOffIcon2) micOffIcon2.style.display = state.remoteMicOn ? "none" : "block";

            ctx.updateUSGButtons?.();
            return;
        }

        // Normal layout: Main = remote camera
        cam0.srcObject = state.remoteStreamLatest || null;
        if (box0) box0.classList.remove("usg-active"); // Remove USG styling
        if (state.remoteStreamLatest && state.remoteCamOn) {
            showVideoEl(cam0);
            if (placeholder0) placeholder0.style.display = "none";
            if (camOffIcon0) camOffIcon0.style.display = "none";
            if (micOffIcon0) micOffIcon0.style.display = state.remoteMicOn ? "none" : "block";
        } else if (state.peerId) {
            // Peer connected but camera is off - show placeholder with off-cam icon
            hideVideoEl(cam0);
            if (placeholder0) { placeholder0.style.display = "flex"; placeholder0.textContent = ""; }
            if (camOffIcon0) camOffIcon0.style.display = state.remoteCamOn ? "none" : "block";
            if (micOffIcon0) micOffIcon0.style.display = state.remoteMicOn ? "none" : "block";
        } else {
            setWaitingUIForSlot(0);
        }
        if (box2) box2.classList.add("hidden");

        ctx.updateUSGButtons?.();
    }

    ctx.applyLayout = applyLayout;

    // WebSocket signaling
    async function connectWS() {
        return new Promise((resolve, reject) => {
            ctx.ws = new WebSocket(state.WS_URL);
            ctx.ws.onopen = () => resolve();
            ctx.ws.onerror = (e) => reject(e);

            ctx.ws.onmessage = async (evt) => {
                let data;
                try { data = JSON.parse(evt.data); } catch { return; }

                switch (data.action) {
                    case "id":
                        state.myId = data.id;
                        break;

                    case "peers":
                        if (data.peers && data.peers.length > 0) {
                            state.peerId = String(data.peers[0]);
                            createPeerIfNeeded();
                            attachLocalTracksIfAny();
                            await doOffer();
                            setTimeout(() => {
                                if (!state.peerId || !ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
                                ctx.ws.send(JSON.stringify({ action: "camera-state", target: state.peerId, state: state.camOn }));
                                ctx.ws.send(JSON.stringify({ action: "mic-state", target: state.peerId, state: state.micOn }));
                            }, 300);
                        }
                        applyLayout();
                        break;

                    case "offer":
                        state.peerId = String(data.from);
                        await handleOffer(data);
                        attachLocalTracksIfAny();
                        // Send our camera/mic state to the remote peer
                        setTimeout(() => {
                            if (!state.peerId || !ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
                            ctx.ws.send(JSON.stringify({ action: "camera-state", target: state.peerId, state: state.camOn }));
                            ctx.ws.send(JSON.stringify({ action: "mic-state", target: state.peerId, state: state.micOn }));
                        }, 300);
                        applyLayout();
                        break;

                    case "answer":
                        if (pc) await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
                        break;

                    case "candidate":
                        if (pc && data.candidate) {
                            try { await pc.addIceCandidate(data.candidate); } catch (e) { console.warn("addIceCandidate failed", e); }
                        }
                        break;

                    case "camera-state":
                        state.remoteCamOn = Boolean(data.state);
                        applyLayout();
                        break;

                    case "mic-state":
                        state.remoteMicOn = Boolean(data.state);
                        applyLayout();
                        break;

                    case "usg-state":
                        const wasSharing = state.remoteUsgSharing;
                        state.remoteUsgSharing = Boolean(data.sharing);

                        // If USG sharing just started and we have camera stream but no USG stream,
                        // swap them because the first track we received was actually USG
                        if (data.sharing && !wasSharing && state.remoteStreamLatest && !state.remoteUsgStreamLatest) {
                            console.log("Swapping streams: first track was USG");
                            state.remoteUsgStreamLatest = state.remoteStreamLatest;
                            state.remoteStreamLatest = null;
                        }

                        ctx.updateUSGButtons?.();
                        applyLayout();
                        break;

                    case "peer-leave":
                        state.peerId = null;
                        state.remoteStreamLatest = null;
                        state.remoteUsgStreamLatest = null;
                        state.remoteUsgSharing = false;
                        state.remoteCamOn = true;
                        state.remoteMicOn = true;
                        if (cam0) cam0.srcObject = null;
                        if (cam2) cam2.srcObject = null;
                        if (pc) pc.close();
                        pc = null;
                        // Reset senders so they can be recreated for new peer
                        state.videoSender = null;
                        state.audioSender = null;
                        state.usgSender = null;
                        applyLayout();
                        break;

                    case "peer-join":
                        // A new peer joined the room
                        // Only initiate connection if we don't have a peer already
                        // (this happens when an existing peer left and a new one joined)
                        // If the PC doesn't exist (peer left before), we prepare for their offer
                        console.log("Peer joined:", data.id, "current peerId:", state.peerId, "pc:", !!pc);

                        if (!pc) {
                            // No existing connection, prepare to receive their offer
                            // The joining user will send us an offer via "peers" flow
                            state.peerId = String(data.id);
                            state.remoteStreamLatest = null;
                            state.remoteUsgStreamLatest = null;
                            state.remoteUsgSharing = false;
                            state.remoteCamOn = true;
                            state.remoteMicOn = true;
                            applyLayout();
                        }

                        // Send our USG state to the new peer so they know to expect USG stream
                        if (state.usgSharing && ctx.ws?.readyState === WebSocket.OPEN) {
                            // Send immediately to ensure state arrives before tracks
                            ctx.ws.send(JSON.stringify({ action: "usg-state", target: data.id, sharing: true }));
                        }
                        // If pc exists, a connection is already in progress - let it continue
                        break;

                    // Remote screenshot/recording request handlers
                    case "request-screenshot":
                        console.log("Received screenshot request from:", data.from);
                        if (ctx.record?.handleRemoteScreenshotRequest) {
                            ctx.record.handleRemoteScreenshotRequest(data.from);
                        }
                        break;

                    case "screenshot-result":
                        console.log("Received screenshot result:", data);
                        if (ctx.record?.handleScreenshotResult) {
                            ctx.record.handleScreenshotResult(data);
                        }
                        break;

                    case "request-start-recording":
                        console.log("Received start recording request from:", data.from);
                        if (ctx.record?.handleRemoteStartRecordingRequest) {
                            ctx.record.handleRemoteStartRecordingRequest(data.from);
                        }
                        break;

                    case "recording-result":
                        console.log("Received recording result:", data);
                        if (ctx.record?.handleRecordingResult) {
                            ctx.record.handleRecordingResult(data);
                        }
                        break;

                    case "recording-state":
                        console.log("Received recording state:", data);
                        if (ctx.record?.handleRecordingState) {
                            ctx.record.handleRecordingState(data);
                        }
                        break;

                    case "request-stop-recording":
                        console.log("Received stop recording request from:", data.from);
                        if (ctx.record?.handleRemoteStopRecordingRequest) {
                            ctx.record.handleRemoteStopRecordingRequest(data.from);
                        }
                        break;

                    case "recording-stopped":
                        console.log("Received recording stopped:", data);
                        if (ctx.record?.handleRecordingStopped) {
                            ctx.record.handleRecordingStopped(data);
                        }
                        break;

                    case "recording-storage-choice":
                        console.log("Received storage choice:", data);
                        if (ctx.record?.handleRecordingStorageChoice) {
                            ctx.record.handleRecordingStorageChoice(data);
                        }
                        break;
                }
            };

            ctx.ws.onclose = () => {
                console.log("WebSocket closed, cleaning up peer connection");
                // Reset peer connection state
                if (pc) {
                    pc.close();
                    pc = null;
                }
                state.peerId = null;
                state.remoteStreamLatest = null;
                state.remoteUsgStreamLatest = null;
                state.remoteUsgSharing = false;
                state.remoteAudioTrack = null;
                // Reset senders
                state.videoSender = null;
                state.audioSender = null;
                state.usgSender = null;
            };
        });
    }

    // Toggle camera
    async function toggleCam() {
        state.camOn = !state.camOn;
        sessionStorage.setItem("camState", String(state.camOn));

        if (!state.camOn) {
            if (state.localVideo) state.localVideo.getTracks().forEach(t => t.stop());
            state.localVideo = null;
            rebuildLocalStream();
            updateLocalVideoUI();
            if (state.videoSender) {
                await state.videoSender.replaceTrack(null).catch(() => { });
                await forceRenegotiate().catch(() => { });
            }
        } else {
            await restartCameraOnly();
        }

        const img = elements.camBtn?.querySelector("img");
        if (img) img.src = state.camOn ? "/static/img/On Cam.png" : "/static/img/Off Cam.png";

        if (ctx.ws && state.peerId) {
            ctx.ws.send(JSON.stringify({ action: "camera-state", target: state.peerId, state: state.camOn }));
        }
        applyLayout();

        // usg-active class on box0 handles overlay hiding automatically via CSS
    }

    function toggleMic() {
        state.micOn = !state.micOn;
        sessionStorage.setItem("micState", String(state.micOn));
        if (state.localAudio) state.localAudio.getAudioTracks().forEach(t => t.enabled = state.micOn);

        const img = elements.micBtn?.querySelector("img");
        if (img) img.src = state.micOn ? "/static/img/On Mic.png" : "/static/img/Off Mic.png";
        if (micOffIcon1) micOffIcon1.style.display = state.micOn ? "none" : "block";

        if (ctx.ws && state.peerId) {
            ctx.ws.send(JSON.stringify({ action: "mic-state", target: state.peerId, state: state.micOn }));
        }
        applyLayout();
    }

    async function loadCamerasMeeting() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === "videoinput");
        if (elements.camSelect0) {
            elements.camSelect0.innerHTML = "";
            cams.forEach((cam, idx) => {
                const opt = document.createElement("option");
                opt.value = cam.deviceId;
                opt.textContent = cam.label || `Kamera ${idx}`;
                elements.camSelect0.appendChild(opt);
            });
        }
        if (!state.selectedCam && cams.length) state.selectedCam = cams[0].deviceId;
        if (state.selectedCam && elements.camSelect0) elements.camSelect0.value = state.selectedCam;

        if (state.camOn && state.selectedCam) await startCamera(state.selectedCam);
        else updateLocalVideoUI();

        if (elements.camSelect0 && !state._camSelectBound) {
            elements.camSelect0.addEventListener("change", async (e) => {
                state.selectedCam = e.target.value || null;
                sessionStorage.setItem("selectedCamera", state.selectedCam || "");
                if (state.camOn && state.selectedCam) {
                    await startCamera(state.selectedCam);
                    const v = state.localVideo?.getVideoTracks?.()[0] || null;
                    if (pc && state.videoSender) {
                        await state.videoSender.replaceTrack(v).catch(() => { });
                        await forceRenegotiate().catch(() => { });
                    }
                }
            });
            state._camSelectBound = true;
        }
    }

    // Load microphones for dropdown
    async function loadMicrophones() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(d => d.kind === "audioinput");
        if (micSelect) {
            micSelect.innerHTML = "";
            mics.forEach((mic, idx) => {
                const opt = document.createElement("option");
                opt.value = mic.deviceId;
                opt.textContent = mic.label || `Mikrofon ${idx}`;
                micSelect.appendChild(opt);
            });
        }

        // Set saved selection if exists
        const savedMic = sessionStorage.getItem("selectedMicrophone");
        if (savedMic && micSelect) micSelect.value = savedMic;

        // Change event
        if (micSelect && !state._micSelectBound) {
            micSelect.addEventListener("change", async (e) => {
                const deviceId = e.target.value || null;
                sessionStorage.setItem("selectedMicrophone", deviceId || "");
                await startMic(deviceId);
            });
            state._micSelectBound = true;
        }
    }

    // Initialize button icons based on current state
    function initButtonIcons() {
        const camImg = elements.camBtn?.querySelector("img");
        if (camImg) camImg.src = state.camOn ? "/static/img/On Cam.png" : "/static/img/Off Cam.png";

        const micImg = elements.micBtn?.querySelector("img");
        if (micImg) micImg.src = state.micOn ? "/static/img/On Mic.png" : "/static/img/Off Mic.png";

        // Also update local video UI icons
        updateLocalVideoUI();
    }

    // Device popup toggle handlers
    function setupPopupHandlers() {
        const micArrow = document.getElementById("micArrow");
        const micPopup = document.getElementById("micPopup");
        const camArrow = document.getElementById("camArrow");
        const camPopup = document.getElementById("camPopup");

        micArrow?.addEventListener("click", (e) => {
            e.stopPropagation();
            micPopup?.classList.toggle("hidden");
            camPopup?.classList.add("hidden");
        });

        camArrow?.addEventListener("click", (e) => {
            e.stopPropagation();
            camPopup?.classList.toggle("hidden");
            micPopup?.classList.add("hidden");
        });

        // Close popups when clicking outside
        document.addEventListener("click", () => {
            micPopup?.classList.add("hidden");
            camPopup?.classList.add("hidden");
        });

        // Prevent popup close when clicking inside
        micPopup?.addEventListener("click", (e) => e.stopPropagation());
        camPopup?.addEventListener("click", (e) => e.stopPropagation());
    }
    setupPopupHandlers();

    return {
        connectWS, createPeerIfNeeded, startMic, loadCamerasMeeting, loadMicrophones,
        toggleCam, toggleMic, applyLayout, initButtonIcons,
        showVideoEl, hideVideoEl, setWaitingUIForSlot, updateLocalVideoUI,
        get pc() { return pc; },
        forceRenegotiate
    };
}

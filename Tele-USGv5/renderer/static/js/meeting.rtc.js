export function initRTC(ctx) {
  const { elements, state } = ctx;
  const { cam0, cam1, cam2, box2, placeholder0, placeholder1, placeholder2,
          camOffIcon0, camOffIcon1, camOffIcon2,
          micOffIcon0, micOffIcon1, micOffIcon2,
          dimmer0 } = elements;

  function showVideoEl(el){ if(!el) return; el.style.display="block"; el.classList.add("play"); }
  function hideVideoEl(el){ if(!el) return; el.style.display="none"; el.classList.remove("play"); }

  function setWaitingUIForSlot(slot){
    if(slot===0){
      hideVideoEl(cam0);
      if(placeholder0){ placeholder0.style.display="flex"; placeholder0.textContent="Menunggu lawan bicara..."; }
      if(camOffIcon0) camOffIcon0.style.display="none";
      if(micOffIcon0) micOffIcon0.style.display="none";
      if(dimmer0) dimmer0.style.display="none";
    } else {
      if(box2) box2.classList.add("hidden");
      hideVideoEl(cam2);
      if(placeholder2){ placeholder2.style.display="flex"; placeholder2.textContent=""; }
      if(camOffIcon2) camOffIcon2.style.display="none";
      if(micOffIcon2) micOffIcon2.style.display="none";
    }
  }

  // expose to ctx for other modules
  ctx._ui = { showVideoEl, hideVideoEl, setWaitingUIForSlot };

  // ---------- Local media ----------
  async function startMic(){
    if(!state.localAudio) state.localAudio = await navigator.mediaDevices.getUserMedia({audio:true});
    state.localAudio.getAudioTracks().forEach(t=>t.enabled=state.micOn);
    rebuildLocalStream();
    if(pc && !state.audioSender){
      const a=state.localAudio.getAudioTracks()[0];
      if(a) state.audioSender = pc.addTrack(a, state.localStream || new MediaStream([a]));
    }
  }

  async function startCamera(deviceId){
    try{
      state.localVideo = await navigator.mediaDevices.getUserMedia({ video: deviceId ? {deviceId:{exact:deviceId}} : true });
      state.localVideo.getVideoTracks().forEach(t=>t.enabled=state.camOn);
      rebuildLocalStream();
      updateLocalVideoUI();
    }catch(e){
      console.error("startCamera error", e);
      state.localVideo=null;
      rebuildLocalStream();
      updateLocalVideoUI();
    }
  }

  function rebuildLocalStream(){
    const tracks=[];
    if(state.localAudio) state.localAudio.getAudioTracks().forEach(t=>{ t.enabled=state.micOn; tracks.push(t); });
    if(state.localVideo) state.localVideo.getVideoTracks().forEach(t=>{ t.enabled=state.camOn; tracks.push(t); });

    state.localStream = new MediaStream(tracks);
    if(cam1){ cam1.srcObject = state.localStream; cam1.muted = true; }
  }

  function updateLocalVideoUI(){
    const live = state.camOn && state.localVideo && state.localVideo.getVideoTracks().some(t=>t.readyState==="live");
    if(live){
      showVideoEl(cam1);
      if(placeholder1) placeholder1.style.display="none";
      if(camOffIcon1) camOffIcon1.style.display="none";
    } else {
      hideVideoEl(cam1);
      if(placeholder1) placeholder1.style.display="flex";
      if(camOffIcon1) camOffIcon1.style.display="block";
    }
  }

  async function restartCameraOnly(){
    if(state.localVideo) state.localVideo.getTracks().forEach(t=>t.stop());
    await startCamera(state.selectedCam || null);
    // update sender track only (jangan ganggu usgSender)
    const v = state.localVideo?.getVideoTracks?.()[0] || null;
    if(pc && state.videoSender){
      await state.videoSender.replaceTrack(v).catch(()=>{});
      await forceRenegotiate().catch(()=>{});
    }
  }

  // ---------- Peer connection ----------
  let pc = null;
  ctx.rtc = { get pc(){return pc;}, forceRenegotiate };

  function createPeerIfNeeded(){
    if(pc) return;
    pc = new RTCPeerConnection({ iceServers: state.iceServers });

    pc.onicecandidate = (e)=>{
      if(e.candidate && ctx.ws && state.peerId){
        ctx.ws.send(JSON.stringify({ action:"candidate", target: state.peerId, candidate: e.candidate }));
      }
    };

    pc.onnegotiationneeded = async ()=>{
      try{ await doOffer(); }catch(e){ console.error("negotiationneeded", e); }
    };

    // Track routing
    const seen = new Set();
    pc.ontrack = (evt)=>{
      const track = evt.track;
      const stream = evt.streams?.[0] || null;
      if(!track) return;
      if(track.kind === "audio") return;
      if(track.kind !== "video") return;
      if(seen.has(track.id)) return;
      seen.add(track.id);

      const remoteIsSharing = Boolean(state.usgActive && state.usgOwnerId && state.usgOwnerId !== state.myId);

      // First video => main camera (remote)
      if(!state.remoteStreamLatest){
        state.remoteStreamLatest = stream;
        applyLayout();
        track.onended = ()=>{ state.remoteStreamLatest = null; applyLayout(); };
        return;
      }

      // Second video => USG only if remote is sharing
      if(!remoteIsSharing){
        return;
      }
      state.remoteUsgStreamLatest = new MediaStream([track]);
      applyLayout();
      track.onended = ()=>{ state.remoteUsgStreamLatest = null; applyLayout(); };
    };
  }

  async function doOffer(){
    if(!pc || !state.peerId || !ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ctx.ws.send(JSON.stringify({ action:"offer", target: state.peerId, sdp: offer.sdp, type:"offer" }));
  }

  async function forceRenegotiate(){
    if(!pc || !state.peerId || !ctx.ws) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ctx.ws.send(JSON.stringify({ action:"offer", target: state.peerId, sdp: offer.sdp, type:"offer" }));
  }

  async function handleOffer(data){
    createPeerIfNeeded();
    await pc.setRemoteDescription({ type:"offer", sdp: data.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ctx.ws.send(JSON.stringify({ action:"answer", target: data.from, sdp: answer.sdp, type:"answer" }));
  }

  function attachLocalTracksIfAny(){
    createPeerIfNeeded();
    if(state.localAudio){
      const a = state.localAudio.getAudioTracks()[0];
      if(a) state.audioSender = pc.addTrack(a, state.localStream || new MediaStream([a]));
    }
    if(state.localVideo && state.camOn){
      const v = state.localVideo.getVideoTracks()[0];
      if(v) state.videoSender = pc.addTrack(v, state.localStream || new MediaStream([v]));
    }
    if(state.usgSharing && state.usgStream){
      const u = state.usgStream.getVideoTracks()[0];
      if(u) state.usgSender = pc.addTrack(u, state.usgStream);
    }
  }

  // ---------- Layout ----------
  function isShareLayout(){
    return Boolean(state.usgSharing || (state.usgActive && state.usgOwnerId && state.usgOwnerId !== state.myId));
  }

  function applyLayout(){
    const share = isShareLayout();

    // Reset icons
    if(camOffIcon0) camOffIcon0.style.display="none";
    if(micOffIcon0) micOffIcon0.style.display="none";
    if(camOffIcon2) camOffIcon2.style.display="none";
    if(micOffIcon2) micOffIcon2.style.display="none";

    if(!state.peerId){
      setWaitingUIForSlot(0);
      if(box2) box2.classList.add("hidden");
      return;
    }

    if(share){
      // camera0 = USG (local share or remote share)
      if(state.usgSharing){
        // local: show own USG stream on cam0
        if(state.usgStream){
          cam0.srcObject = state.usgStream;
          showVideoEl(cam0);
          if(placeholder0) placeholder0.style.display="none";
        }
      } else {
        // remote share: show remote USG on cam0
        if(state.remoteUsgStreamLatest){
          cam0.srcObject = state.remoteUsgStreamLatest;
          showVideoEl(cam0);
          if(placeholder0) placeholder0.style.display="none";
        } else {
          // waiting for USG track
          hideVideoEl(cam0);
          if(placeholder0){ placeholder0.style.display="flex"; placeholder0.textContent="Mengirim USG..."; }
        }
      }

      // camera2 = remote main camera
      if(box2) box2.classList.remove("hidden");
      cam2.srcObject = state.remoteStreamLatest || null;
      if(state.remoteStreamLatest){
        showVideoEl(cam2);
        if(placeholder2) placeholder2.style.display="none";
      } else {
        hideVideoEl(cam2);
        if(placeholder2){ placeholder2.style.display="flex"; placeholder2.textContent=""; }
      }

      // remote camera/mic states in share layout => icons on camera2
      if(camOffIcon2) camOffIcon2.style.display = state.remoteCamOn ? "none" : "block";
      if(micOffIcon2) micOffIcon2.style.display = state.remoteMicOn ? "none" : "block";
      return;
    }

    // normal layout: camera0 = remote main
    cam0.srcObject = state.remoteStreamLatest || null;
    if(state.remoteStreamLatest){
      showVideoEl(cam0);
      if(placeholder0) placeholder0.style.display="none";
      if(camOffIcon0) camOffIcon0.style.display = state.remoteCamOn ? "none" : "block";
      if(micOffIcon0) micOffIcon0.style.display = state.remoteMicOn ? "none" : "block";
    } else {
      setWaitingUIForSlot(0);
    }
    if(box2) box2.classList.add("hidden");
  }

  ctx.applyLayout = applyLayout;

  // ---------- Signaling ----------
  async function connectWS(){
    return new Promise((resolve, reject)=>{
      ctx.ws = new WebSocket(state.WS_URL);
      ctx.ws.onopen = ()=>resolve();
      ctx.ws.onerror = (e)=>reject(e);

      ctx.ws.onmessage = async (evt)=>{
        let data;
        try{ data = JSON.parse(evt.data); }catch{ return; }

        switch(data.action){
          case "id":
            state.myId = data.id;
            break;

          case "peers":
            if(data.peers && data.peers.length>0){
              state.peerId = String(data.peers[0]);
              createPeerIfNeeded();
              attachLocalTracksIfAny();
              await doOffer();

              // broadcast initial states
              setTimeout(()=>{
                if(!state.peerId || !ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
                ctx.ws.send(JSON.stringify({ action:"camera-state", target: state.peerId, state: state.camOn }));
                ctx.ws.send(JSON.stringify({ action:"mic-state", target: state.peerId, state: state.micOn }));
              }, 300);
            }
            applyLayout();
            break;

          case "offer":
            state.peerId = String(data.from);
            await handleOffer(data);
            attachLocalTracksIfAny();
            applyLayout();
            break;

          case "answer":
            if(pc) await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
            break;

          case "candidate":
            if(pc && data.candidate){
              try{ await pc.addIceCandidate(data.candidate); }catch(e){ console.warn("addIceCandidate failed", e); }
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

          case "peer-leave":
            state.peerId = null;
            state.remoteStreamLatest = null;
            state.remoteUsgStreamLatest = null;
            if(cam0) cam0.srcObject = null;
            if(cam2) cam2.srcObject = null;
            if(pc) pc.close();
            pc = null;
            applyLayout();
            break;
        }
      };
    });
  }

  // ---------- UI toggles ----------
  async function toggleCam(){
    state.camOn = !state.camOn;
    sessionStorage.setItem("camState", String(state.camOn));

    if(!state.camOn){
      // stop local camera and send null track (kecuali USG)
      if(state.localVideo) state.localVideo.getTracks().forEach(t=>t.stop());
      state.localVideo = null;
      rebuildLocalStream();
      updateLocalVideoUI();

      if(state.videoSender){
        await state.videoSender.replaceTrack(null).catch(()=>{});
        await forceRenegotiate().catch(()=>{});
      }
    } else {
      // restart camera only (avoid touching audio + usgSender)
      await restartCameraOnly();
    }

    // update icon
    const img = elements.camBtn?.querySelector("img");
    if(img) img.src = state.camOn ? "/static/img/Icon.png" : "/static/img/Camera off.png";

    // notify peer
    if(ctx.ws && state.peerId){
      ctx.ws.send(JSON.stringify({ action:"camera-state", target: state.peerId, state: state.camOn }));
    }
    applyLayout();
  }

  function toggleMic(){
    state.micOn = !state.micOn;
    sessionStorage.setItem("micState", String(state.micOn));
    if(state.localAudio) state.localAudio.getAudioTracks().forEach(t=>t.enabled=state.micOn);

    const img = elements.micBtn?.querySelector("img");
    if(img) img.src = state.micOn ? "/static/img/Mic.png" : "/static/img/Mic off.png";
    if(micOffIcon1) micOffIcon1.style.display = state.micOn ? "none" : "block";

    if(ctx.ws && state.peerId){
      ctx.ws.send(JSON.stringify({ action:"mic-state", target: state.peerId, state: state.micOn }));
    }
    applyLayout();
  }

  async function loadCamerasMeeting(){
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d=>d.kind==="videoinput");
    if(elements.camSelect0){
      elements.camSelect0.innerHTML="";
      cams.forEach((cam, idx)=>{
        const opt=document.createElement("option");
        opt.value = cam.deviceId;
        opt.textContent = cam.label || `Kamera ${idx}`;
        elements.camSelect0.appendChild(opt);
      });
    }
    if(!state.selectedCam && cams.length) state.selectedCam=cams[0].deviceId;
    if(state.selectedCam && elements.camSelect0) elements.camSelect0.value=state.selectedCam;

    if(state.camOn && state.selectedCam) await startCamera(state.selectedCam);
    else updateLocalVideoUI();

    // change event
    if(elements.camSelect0 && !state._camSelectBound){
      elements.camSelect0.addEventListener("change", async (e)=>{
        state.selectedCam = e.target.value || null;
        sessionStorage.setItem("selectedCamera", state.selectedCam || "");
        if(state.camOn && state.selectedCam){
          await startCamera(state.selectedCam);
          const v = state.localVideo?.getVideoTracks?.()[0] || null;
          if(pc && state.videoSender){
            await state.videoSender.replaceTrack(v).catch(()=>{});
            await forceRenegotiate().catch(()=>{});
          }
        }
      });
      state._camSelectBound=true;
    }
  }

  return {
    connectWS,
    createPeerIfNeeded,
    startMic,
    loadCamerasMeeting,
    toggleCam,
    toggleMic,
    applyLayout,
    showVideoEl,
    hideVideoEl,
    setWaitingUIForSlot,
    updateLocalVideoUI,
  };
}

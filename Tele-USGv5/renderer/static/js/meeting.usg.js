// meeting.usg.js
// USG Preview via local Python WS + Share via 2nd WebRTC video track

export function initUSG(ctx) {
  const { elements, state } = ctx;
  const {
    btnShareCam, usgModal, usgConfirm, usgCancel, usgCamSelect,
    usgCanvas, usgCtx,
  } = elements;

  // ---- Local preview socket (Python) ----
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

  function stopWatchdog() {
    if (state.usgFrameTimer) { clearTimeout(state.usgFrameTimer); state.usgFrameTimer = null; }
  }
  function armWatchdog() {
    stopWatchdog();
    state.usgFrameTimer = setTimeout(() => drawCanvasStatus("Kamera tidak tersedia"), 1500);
  }

  function closeUSGWS() {
    try {
      if (state.usgWS) {
        try { state.usgWS.send(JSON.stringify({ action: "stop-share" })); } catch {}
        state.usgWS.close();
      }
    } catch {}
    state.usgWS = null;
  }

  function populateUSGCameraSelect(list) {
    if (!usgCamSelect) return;
    usgCamSelect.innerHTML = "";
    // list berisi index OpenCV asli (misal [0,2,3])
    for (let i = 0; i < list.length; i++) {
      const camIdx = list[i];
      const opt = document.createElement("option");
      opt.value = String(camIdx);
      opt.textContent = `Camera ${camIdx}`;
      usgCamSelect.appendChild(opt);
    }
    // jangan paksa ke item 0; pertahankan pilihan user kalau masih ada
    if (!usgCamSelect.value && list.length) usgCamSelect.value = String(list[0]);
  }

  function connectUSGPreview() {
    if (!usgCanvas || !usgCtx) return;
    closeUSGWS();
    drawCanvasStatus("Menghubungkan kamera...");

    const ws = new WebSocket("ws://127.0.0.1:9000");
    ws.binaryType = "arraybuffer";
    state.usgWS = ws;

    ws.onopen = () => {
      try { ws.send(JSON.stringify({ action: "list-cameras" })); } catch {}
      armWatchdog();
    };

    ws.onmessage = async (evt) => {
      if (typeof evt.data === "string") {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.action === "camera-list" && Array.isArray(msg.cameras)) {
            populateUSGCameraSelect(msg.cameras);
            // preview kamera sesuai dropdown (index OpenCV!)
            const idx = Number(usgCamSelect?.value ?? (msg.cameras[0] ?? 0));
            try { ws.send(JSON.stringify({ action: "preview-camera", index: idx })); } catch {}
          }
        } catch {}
        return;
      }

      armWatchdog();
      try {
        const blob = new Blob([evt.data], { type: "image/jpeg" });
        const bitmap = await createImageBitmap(blob);
        usgCtx.drawImage(bitmap, 0, 0, usgCanvas.width, usgCanvas.height);
      } catch {
        drawCanvasStatus("Kamera tidak tersedia");
      }
    };

    ws.onerror = () => drawCanvasStatus("Kamera tidak tersedia");
    ws.onclose = () => stopWatchdog();
  }

  function openModal() {
    if (!usgModal) return;
    usgModal.classList.remove("hidden");
    connectUSGPreview();
  }

  function closeModal() {
    if (!usgModal) return;
    usgModal.classList.add("hidden");
    closeUSGWS();
    stopWatchdog();
    if (usgCanvas && usgCtx) usgCtx.clearRect(0, 0, usgCanvas.width, usgCanvas.height);
  }

  // ---- Share control ----
  async function startShareUSG() {
    // lock: hanya 1 orang per room
    if (state.usgActive && state.usgOwnerId && state.usgOwnerId !== state.myId) {
      alert("USG sedang dishare oleh lawan bicara.");
      return;
    }
    state.usgSharing = true;

    // pilih index OpenCV dari dropdown (bukan 0 selalu)
    const idx = Number(usgCamSelect?.value ?? 0);

    // pastikan python stream sesuai index
    try {
      if (state.usgWS && state.usgWS.readyState === WebSocket.OPEN) {
        state.usgWS.send(JSON.stringify({ action: "start-share", index: idx }));
      }
    } catch {}

    // capture canvas sebagai stream USG
    if (!usgCanvas) return;
    if (state.usgStream) {
      try { state.usgStream.getTracks().forEach(t => t.stop()); } catch {}
      state.usgStream = null;
    }
    state.usgStream = usgCanvas.captureStream(20);
    const usgTrack = state.usgStream.getVideoTracks()[0];

    // pasang sebagai track kedua ke WebRTC (JANGAN ganti camera track)
    if (ctx.rtc?.pc && usgTrack) {
      try {
        if (state.usgSender) {
          await state.usgSender.replaceTrack(usgTrack);
        } else {
          state.usgSender = ctx.rtc.pc.addTrack(usgTrack, state.usgStream);
        }
        await ctx.rtc.forceRenegotiate();
      } catch (err) {
        console.error("attach USG track failed:", err);
      }
    }

    // update global lock via RTDB
    await ctx.firebaseDb.set(ctx.usgStateRef, { active: true, owner: state.myId, ts: Date.now() });

    // update UI icon
    const img = btnShareCam?.querySelector("img");
    if (img) img.src = "/static/img/Stop.png";

    // layout
    ctx.applyLayout();
  }

  async function stopShareUSG() {
    if (!state.usgSharing) return;
    state.usgSharing = false;

    // remove usg track from WebRTC
    try {
      if (ctx.rtc?.pc && state.usgSender) {
        ctx.rtc.pc.removeTrack(state.usgSender);
        state.usgSender = null;
        await ctx.rtc.forceRenegotiate();
      }
    } catch (e) { console.warn("remove usg sender failed", e); }

    // stop local canvas stream
    try {
      if (state.usgStream) {
        state.usgStream.getTracks().forEach(t => t.stop());
        state.usgStream = null;
      }
    } catch {}

    // stop python and close socket (release camera)
    try {
      if (state.usgWS && state.usgWS.readyState === WebSocket.OPEN) {
        state.usgWS.send(JSON.stringify({ action: "stop-share" }));
      }
    } catch {}
    closeUSGWS();

    // update global lock via RTDB
    await ctx.firebaseDb.set(ctx.usgStateRef, { active: false, owner: null, ts: Date.now() });

    // update button icon
    const img = btnShareCam?.querySelector("img");
    if (img) img.src = "/static/img/Share.png";

    ctx.applyLayout();
  }

  // Events
  if (btnShareCam) {
    btnShareCam.addEventListener("click", () => {
      if (state.usgSharing) stopShareUSG().catch(console.error);
      else openModal();
    });
  }
  if (usgConfirm) usgConfirm.addEventListener("click", () => { closeModal(); startShareUSG().catch(console.error); });
  if (usgCancel) usgCancel.addEventListener("click", closeModal);
  if (usgCamSelect) usgCamSelect.addEventListener("change", () => {
    if (!state.usgWS || state.usgWS.readyState !== WebSocket.OPEN) return;
    const idx = Number(usgCamSelect.value);
    try { state.usgWS.send(JSON.stringify({ action: "preview-camera", index: idx })); } catch {}
    drawCanvasStatus("Mengganti kamera...");
    armWatchdog();
  });

  return { startShareUSG, stopShareUSG, connectUSGPreview, closeUSGWS };
}

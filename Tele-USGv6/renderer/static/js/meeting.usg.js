// meeting.usg.js - Simplified USG Camera Sharing
export function initUSG(ctx) {
    const { elements, state } = ctx;
    const { btnShareCam, usgModal, usgConfirm, usgCancel, usgCamSelect, usgCanvas, usgCtx, aiModelSelect } = elements;

    // Draw status text on canvas
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

    // Watchdog for frame timeout
    function stopWatchdog() {
        if (state.usgFrameTimer) { clearTimeout(state.usgFrameTimer); state.usgFrameTimer = null; }
    }
    function armWatchdog() {
        stopWatchdog();
        state.usgFrameTimer = setTimeout(() => drawCanvasStatus("Kamera tidak tersedia"), 2000);
    }

    // Close USG WebSocket
    function closeUSGWS() {
        try {
            if (state.usgWS) {
                try { state.usgWS.send(JSON.stringify({ action: "stop-share" })); } catch { }
                state.usgWS.close();
            }
        } catch { }
        state.usgWS = null;
    }

    // Populate camera dropdown from Python
    function populateUSGCameraSelect(list) {
        if (!usgCamSelect) return;
        usgCamSelect.innerHTML = "";
        for (let i = 0; i < list.length; i++) {
            const camIdx = list[i];
            const opt = document.createElement("option");
            opt.value = String(camIdx);
            opt.textContent = `Camera ${camIdx}`;
            usgCamSelect.appendChild(opt);
        }
        if (!usgCamSelect.value && list.length) usgCamSelect.value = String(list[0]);
    }

    // Connect to Python USG WebSocket
    function connectUSGPreview() {
        if (!usgCanvas || !usgCtx) return;
        closeUSGWS();
        drawCanvasStatus("Menghubungkan kamera...");

        const ws = new WebSocket("ws://127.0.0.1:9000");
        ws.binaryType = "arraybuffer";
        state.usgWS = ws;

        ws.onopen = () => {
            try { ws.send(JSON.stringify({ action: "list-cameras" })); } catch { }
            armWatchdog();
        };

        ws.onmessage = async (evt) => {
            if (typeof evt.data === "string") {
                try {
                    const msg = JSON.parse(evt.data);
                    if (msg.action === "camera-list" && Array.isArray(msg.cameras)) {
                        populateUSGCameraSelect(msg.cameras);
                        const idx = Number(usgCamSelect?.value ?? (msg.cameras[0] ?? 0));
                        try { ws.send(JSON.stringify({ action: "preview-camera", index: idx })); } catch { }
                    }
                } catch { }
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

    // Close modal but keep WebSocket running (for sharing)
    function hideModalOnly() {
        if (!usgModal) return;
        usgModal.classList.add("hidden");
    }

    // Full close - closes WebSocket too (for cancel)
    function closeModal() {
        if (!usgModal) return;
        usgModal.classList.add("hidden");
        if (!state.usgSharing) {
            closeUSGWS();
            stopWatchdog();
            if (usgCanvas && usgCtx) usgCtx.clearRect(0, 0, usgCanvas.width, usgCanvas.height);
        }
    }

    // Start sharing USG
    async function startShareUSG() {
        // Check if someone else is sharing
        if (state.remoteUsgSharing) {
            alert("USG sedang dishare oleh lawan bicara.");
            return;
        }

        state.usgSharing = true;
        const idx = Number(usgCamSelect?.value ?? 0);

        // Send AI model selection to Python backend
        const aiMode = aiModelSelect?.value || "none";
        try {
            if (state.usgWS && state.usgWS.readyState === WebSocket.OPEN) {
                state.usgWS.send(JSON.stringify({ action: "set-ai-model", mode: aiMode }));
            }
        } catch { }

        // Tell Python to start streaming
        try {
            if (state.usgWS && state.usgWS.readyState === WebSocket.OPEN) {
                state.usgWS.send(JSON.stringify({ action: "start-share", index: idx }));
            }
        } catch { }

        // Wait a bit for canvas to start receiving frames
        await new Promise(resolve => setTimeout(resolve, 500));

        // Capture canvas as stream
        if (!usgCanvas) return;
        if (state.usgStream) {
            try { state.usgStream.getTracks().forEach(t => t.stop()); } catch { }
            state.usgStream = null;
        }
        state.usgStream = usgCanvas.captureStream(20);
        const usgTrack = state.usgStream.getVideoTracks()[0];

        if (!usgTrack) {
            console.error("Failed to capture USG track from canvas");
            state.usgSharing = false;
            return;
        }

        console.log("USG track captured:", usgTrack.id, usgTrack.readyState);

        // Add USG track to WebRTC using addTrack
        // Ensure peer connection is created first
        ctx.rtc?.createPeerIfNeeded?.();

        if (ctx.rtc?.pc && usgTrack) {
            try {
                if (state.usgSender) {
                    await state.usgSender.replaceTrack(usgTrack);
                    console.log("USG track replaced on existing sender");
                } else {
                    state.usgSender = ctx.rtc.pc.addTrack(usgTrack, state.usgStream);
                    console.log("USG track added via addTrack");
                }
                // Renegotiate to notify remote peer
                await ctx.rtc.forceRenegotiate();
                console.log("Renegotiation complete");
            } catch (err) {
                console.error("attach USG track failed:", err);
            }
        } else {
            console.error("WebRTC pc not available");
        }

        // Update Firebase lock
        await ctx.firebaseDb.set(ctx.usgStateRef, { active: true, owner: state.myId, ts: Date.now() });

        // Notify peer via WebSocket
        if (ctx.ws && state.peerId) {
            ctx.ws.send(JSON.stringify({ action: "usg-state", target: state.peerId, sharing: true }));
        }

        // Update button icon
        const img = btnShareCam?.querySelector("img");
        if (img) img.src = "/static/img/Stop Share Screen.png";

        ctx.updateUSGButtons?.();
        ctx.applyLayout?.();
    }

    // Stop sharing USG
    async function stopShareUSG() {
        if (!state.usgSharing) return;
        state.usgSharing = false;

        // Clear USG track from transceiver (use replaceTrack(null) instead of removeTrack)
        try {
            if (state.usgTransceiver && state.usgSender) {
                await state.usgSender.replaceTrack(null);
                console.log("USG track cleared from transceiver");
            }
            state.usgSender = null;
        } catch (e) { console.warn("clear usg track failed", e); }

        // Stop canvas stream
        try {
            if (state.usgStream) {
                state.usgStream.getTracks().forEach(t => t.stop());
                state.usgStream = null;
            }
        } catch { }

        // Tell Python to stop and reset AI model
        try {
            if (state.usgWS && state.usgWS.readyState === WebSocket.OPEN) {
                state.usgWS.send(JSON.stringify({ action: "set-ai-model", mode: "none" }));
                state.usgWS.send(JSON.stringify({ action: "stop-share" }));
            }
        } catch { }
        closeUSGWS();

        // Update Firebase lock
        await ctx.firebaseDb.set(ctx.usgStateRef, { active: false, owner: null, ts: Date.now() });

        // Notify peer
        if (ctx.ws && state.peerId) {
            ctx.ws.send(JSON.stringify({ action: "usg-state", target: state.peerId, sharing: false }));
        }

        // Update button icon
        const img = btnShareCam?.querySelector("img");
        if (img) img.src = "/static/img/Share Screen.png";

        ctx.updateUSGButtons?.();
        ctx.applyLayout?.();
    }

    // Event bindings
    if (btnShareCam) {
        btnShareCam.addEventListener("click", () => {
            if (state.usgSharing) stopShareUSG().catch(console.error);
            else openModal();
        });
    }
    if (usgConfirm) usgConfirm.addEventListener("click", () => { hideModalOnly(); startShareUSG().catch(console.error); });
    if (usgCancel) usgCancel.addEventListener("click", closeModal);
    if (usgCamSelect) {
        usgCamSelect.addEventListener("change", () => {
            if (!state.usgWS || state.usgWS.readyState !== WebSocket.OPEN) return;
            const idx = Number(usgCamSelect.value);
            try { state.usgWS.send(JSON.stringify({ action: "preview-camera", index: idx })); } catch { }
            drawCanvasStatus("Mengganti kamera...");
            armWatchdog();
        });
    }

    // AI model change handler: send selection to Python in real-time
    if (aiModelSelect) {
        aiModelSelect.addEventListener("change", () => {
            if (!state.usgWS || state.usgWS.readyState !== WebSocket.OPEN) return;
            const mode = aiModelSelect.value;
            try { state.usgWS.send(JSON.stringify({ action: "set-ai-model", mode })); } catch { }
        });
    }

    return {
        startShareUSG,
        stopShareUSG,
        connectUSGPreview,
        closeUSGWS,
        openModal,
        closeModal,
        hideModalOnly,
        cleanup: closeUSGWS
    };
}


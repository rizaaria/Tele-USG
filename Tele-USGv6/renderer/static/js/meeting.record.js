// meeting.record.js - Screenshot and Recording with Python OpenCV Backend
export function initRecord(ctx) {
    const { elements, state, roomID, auth } = ctx;
    const { btnScreenshot, btnRecord, recordingIndicator, usgCanvas } = elements;

    let isRecording = false;
    let isRemoteRecording = false; // Track if remote is recording (for Client B UI)

    // Recording timer
    const recordingTimer = document.getElementById('recordingTimer');
    let timerInterval = null;
    let recordingStartTime = null;

    function updateTimer() {
        if (!recordingStartTime) return;
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        if (recordingTimer) recordingTimer.textContent = `${mins}:${secs}`;
    }

    function startTimer() {
        recordingStartTime = Date.now();
        if (recordingTimer) {
            recordingTimer.classList.remove('hidden');
            recordingTimer.textContent = '00:00';
        }
        timerInterval = setInterval(updateTimer, 1000);
    }

    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        recordingStartTime = null;
        if (recordingTimer) recordingTimer.classList.add('hidden');
    }

    // Cloud storage limit (100MB per user)
    const CLOUD_LIMIT_BYTES = 100 * 1024 * 1024; // 100MB

    // Storage modal elements
    const storageModal = document.getElementById('storageModal');
    const storageModalText = document.getElementById('storageModalText');
    const storageUsageText = document.getElementById('storageUsageText');
    const storageCloudBtn = document.getElementById('storageCloudBtn');
    const storageLocalBtn = document.getElementById('storageLocalBtn');
    const storageCancelBtn = document.getElementById('storageCancelBtn');

    // Pending media for storage choice
    let pendingMedia = null;
    let currentStorageUsage = 0;

    // Toast notification system
    function showToast(message, type = "success", duration = 3000) {
        const existing = document.querySelector(".toast-notification");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.className = "toast-notification";
        toast.innerHTML = `
            <div class="toast-icon">${type === "success" ? '<img src="/static/img/Succes.png" class="toast-img">' : type === "error" ? '<img src="/static/img/Error.png" class="toast-img">' : '<img src="/static/img/Loading.png" class="toast-img">'}</div>
            <div class="toast-message">${message}</div>
        `;

        const colors = {
            success: "linear-gradient(135deg, #2ecc71, #27ae60)",
            error: "linear-gradient(135deg, #e74c3c, #c0392b)",
            loading: "linear-gradient(135deg, #3498db, #2980b9)"
        };

        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: ${colors[type] || colors.success};
            color: white;
            padding: 12px 24px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 99999;
            animation: toast-slide-up 0.3s ease-out;
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            font-weight: 500;
        `;

        document.body.appendChild(toast);

        if (duration > 0) {
            setTimeout(() => {
                toast.style.animation = "toast-slide-down 0.3s ease-in forwards";
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        return toast;
    }

    // Format bytes to human readable
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Fetch current cloud storage usage (per room)
    async function fetchStorageUsage() {
        try {
            const response = await fetch(`/api/storage-usage?roomId=${roomID}`);
            if (response.ok) {
                const data = await response.json();
                return data.totalBytes || 0;
            }
        } catch (err) {
            console.warn("Could not fetch storage usage:", err);
        }
        return 0;
    }

    // Show storage choice modal
    async function showStorageChoice(mediaType, filePath, filename) {
        pendingMedia = { type: mediaType, filePath, filename };
        storageModalText.textContent = `Pilih lokasi penyimpanan untuk ${mediaType === 'screenshot' ? 'screenshot' : 'rekaman'}:`;

        // Fetch and display storage usage
        currentStorageUsage = await fetchStorageUsage();
        const usedMB = (currentStorageUsage / (1024 * 1024)).toFixed(2);
        const limitMB = (CLOUD_LIMIT_BYTES / (1024 * 1024)).toFixed(0);

        if (currentStorageUsage >= CLOUD_LIMIT_BYTES) {
            storageUsageText.innerHTML = `<img src="/static/img/Warning.png" class="inline-icon" alt=""> Penyimpanan cloud penuh (${usedMB}/${limitMB} MB)`;
            storageUsageText.className = 'storage-usage warning';
            storageCloudBtn.disabled = true;
            storageCloudBtn.title = 'Batas penyimpanan cloud tercapai';
        } else {
            storageUsageText.innerHTML = `<img src="/static/img/Cloud.png" class="inline-icon" alt=""> Penggunaan cloud: ${usedMB}/${limitMB} MB`;
            storageUsageText.className = 'storage-usage';
            storageCloudBtn.disabled = false;
            storageCloudBtn.title = '';
        }

        storageModal.classList.remove('hidden');
    }

    // Hide storage modal
    function hideStorageModal() {
        storageModal.classList.add('hidden');
        pendingMedia = null;
    }

    // Cancel button handler - TRUE CANCEL: delete local file
    if (storageCancelBtn) {
        storageCancelBtn.addEventListener('click', async () => {
            if (pendingMedia && window.electronAPI) {
                const { type, filename } = pendingMedia;
                const mediaFolder = type === 'screenshot' ? 'screenshots' : 'recordings';
                try {
                    await window.electronAPI.deleteLocalFile(roomID, mediaFolder, filename);
                    console.log("🗑️ Local file deleted (cancelled):", filename);
                } catch (err) {
                    console.warn("Could not delete local file:", err);
                }
            }
            hideStorageModal();
            showToast("Penyimpanan dibatalkan", "success");
        });
    }

    // Ensure patient record exists in Firebase (auto-create if needed)
    async function ensurePatientRecord() {
        const isDevMode = sessionStorage.getItem("devMode") === "true";
        const user = auth.currentUser;

        // Get user path - use "dev" for dev mode
        let userPath;
        if (isDevMode) {
            userPath = "dev";
        } else if (user) {
            userPath = user.uid;
        } else {
            console.warn("No user and not in dev mode, cannot save patient record");
            return;
        }

        const { ref, get, set, update } = ctx.firebaseDb;
        // Use room-based path for consistency
        const notesRef = ref(ctx.db, `rooms/${roomID}/notes`);

        try {
            // Get current room participants to store them permanently
            const participantsRef = ref(ctx.db, `rooms/${roomID}/participants`);
            const participantsSnap = await get(participantsRef);
            const currentParticipants = participantsSnap.exists() ? Object.keys(participantsSnap.val()) : [];

            const snapshot = await get(notesRef);
            if (!snapshot.exists()) {
                // Create minimal patient record with current participants as allowed users
                await set(notesRef, {
                    roomID: roomID,
                    timestamp: new Date().toISOString(),
                    patient_name: `Pasien ${roomID}`,
                    created_from: 'media_capture',
                    createdBy: userPath,
                    allowedUsers: currentParticipants,
                    isDevRecord: isDevMode
                });
                console.log("✅ Auto-created patient record for roomID:", roomID, "with participants:", currentParticipants);
            } else {
                // Update allowedUsers to include any new participants
                const existingData = snapshot.val();
                const existingAllowed = existingData.allowedUsers || [];
                const mergedAllowed = [...new Set([...existingAllowed, ...currentParticipants])];

                if (mergedAllowed.length > existingAllowed.length) {
                    await update(notesRef, { allowedUsers: mergedAllowed });
                    console.log("📝 Updated allowedUsers for roomID:", roomID, mergedAllowed);
                }
            }
        } catch (err) {
            console.error("Error ensuring patient record:", err);
        }
    }

    // Upload progress UI
    let progressOverlay = null;

    function showUploadProgress(type) {
        // Create progress overlay if not exists
        if (!progressOverlay) {
            progressOverlay = document.createElement("div");
            progressOverlay.id = "uploadProgressOverlay";
            progressOverlay.innerHTML = `
                <div class="upload-progress-modal">
                    <div class="upload-progress-title">Mengupload <span id="uploadType"></span>...</div>
                    <div class="upload-progress-bar-container">
                        <div class="upload-progress-bar" id="uploadProgressBar"></div>
                    </div>
                    <div class="upload-progress-text"><span id="uploadProgressPercent">0</span>%</div>
                </div>
            `;
            progressOverlay.style.cssText = `
                position: fixed; inset: 0; background: rgba(0,0,0,0.7);
                display: flex; align-items: center; justify-content: center;
                z-index: 100000;
            `;
            document.body.appendChild(progressOverlay);

            // Add styles for progress bar (matching app theme: white, grey, blue)
            const style = document.createElement("style");
            style.id = "uploadProgressStyles";
            style.textContent = `
                .upload-progress-modal {
                    background: white;
                    padding: 40px 60px;
                    border-radius: 20px;
                    text-align: center;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                    min-width: 320px;
                }
                .upload-progress-title {
                    color: #333;
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 25px;
                    font-family: 'Poppins', sans-serif;
                }
                .upload-progress-bar-container {
                    width: 100%;
                    height: 14px;
                    background: #e8e8e8;
                    border-radius: 7px;
                    overflow: hidden;
                }
                .upload-progress-bar {
                    height: 100%;
                    width: 0%;
                    background: linear-gradient(90deg, #5969F2, #7B8AF7);
                    border-radius: 7px;
                    transition: width 0.15s ease-out;
                }
                .upload-progress-text {
                    color: #5969F2;
                    font-size: 28px;
                    font-weight: 700;
                    margin-top: 20px;
                    font-family: 'Poppins', sans-serif;
                }
            `;
            if (!document.getElementById("uploadProgressStyles")) {
                document.head.appendChild(style);
            }
        }

        document.getElementById("uploadType").textContent = type === 'screenshot' ? 'Screenshot' : 'Rekaman';
        document.getElementById("uploadProgressBar").style.width = "0%";
        document.getElementById("uploadProgressPercent").textContent = "0";
        progressOverlay.style.display = "flex";
    }

    function updateUploadProgress(percent) {
        const bar = document.getElementById("uploadProgressBar");
        const text = document.getElementById("uploadProgressPercent");
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.textContent = Math.round(percent);
    }

    function hideUploadProgress() {
        if (progressOverlay) {
            progressOverlay.style.display = "none";
        }
    }

    // Upload to Cloudinary with progress tracking
    function uploadToCloudinary(file, folder, resourceType = "auto") {
        return new Promise((resolve, reject) => {
            const cloudName = state.cloudinaryConfig?.cloud_name || "dvrhkk8ss";
            const uploadPreset = state.cloudinaryConfig?.upload_preset || "teleusg_uploads";

            const formData = new FormData();
            formData.append("file", file);
            formData.append("upload_preset", uploadPreset);
            formData.append("folder", `teleusg/${roomID}/${folder}`);

            const xhr = new XMLHttpRequest();
            xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`);

            // Track upload progress
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    updateUploadProgress(percent);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const data = JSON.parse(xhr.responseText);
                    console.log("✅ Uploaded to Cloudinary:", data.secure_url);
                    resolve(data);
                } else {
                    reject(new Error("Upload failed: " + xhr.statusText));
                }
            };

            xhr.onerror = () => reject(new Error("Upload failed"));
            xhr.send(formData);
        });
    }

    // Save media reference to Firebase (room-scoped)
    async function saveMediaReference(type, cloudinaryData) {
        try {
            const { ref, push, set } = ctx.firebaseDb;
            const mediaRef = ref(ctx.db, `rooms/${roomID}/media/${type}`);
            const newRef = push(mediaRef);

            console.log(`📝 Saving media to Firebase: rooms/${roomID}/media/${type}`);

            await set(newRef, {
                url: cloudinaryData.secure_url,
                publicId: cloudinaryData.public_id,
                timestamp: Date.now(),
                format: cloudinaryData.format,
                bytes: cloudinaryData.bytes,
                width: cloudinaryData.width,
                height: cloudinaryData.height
            });

            console.log(`✅ Media saved to Firebase with key: ${newRef.key}`);
            return newRef.key;
        } catch (error) {
            console.error(`❌ Failed to save media to Firebase:`, error);
            showToast("Gagal menyimpan referensi ke Firebase: " + error.message, "error");
            throw error;
        }
    }

    // Handle cloud upload choice
    async function handleCloudUpload() {
        if (!pendingMedia) return;

        const { type, filePath, filename } = pendingMedia;
        const savedPendingMedia = { ...pendingMedia }; // Save for retry
        hideStorageModal();

        try {
            // Show progress overlay instead of toast
            showUploadProgress(type);

            // Read the file that Python saved locally
            const mediaFolder = type === 'screenshot' ? 'screenshots' : 'recordings';
            const response = await fetch(`/savedata/${roomID}/${mediaFolder}/${filename}`);
            const blob = await response.blob();

            const file = new File([blob], filename, { type: blob.type });
            const resourceType = type === 'screenshot' ? 'image' : 'video';

            const cloudinaryData = await uploadToCloudinary(file, mediaFolder, resourceType);
            await saveMediaReference(mediaFolder, cloudinaryData);

            // Delete local file after successful cloud upload (cloud-only)
            if (window.electronAPI) {
                try {
                    await window.electronAPI.deleteLocalFile(roomID, mediaFolder, filename);
                    console.log("✅ Local file deleted after cloud upload:", filename);
                } catch (deleteErr) {
                    console.warn("Could not delete local file:", deleteErr);
                }
            }

            // Hide progress and show success
            hideUploadProgress();
            showToast(`${type === 'screenshot' ? 'Screenshot' : 'Rekaman'} tersimpan ke cloud!`, "success");
        } catch (err) {
            hideUploadProgress();
            // Show error with retry and save-to-local options
            showUploadError(err.message, savedPendingMedia);
        }
    }

    // Show upload error modal with retry and save-to-local options
    function showUploadError(errorMessage, mediaData) {
        // Remove existing error modal if any
        const existingModal = document.getElementById('uploadErrorModal');
        if (existingModal) existingModal.remove();

        const errorModal = document.createElement('div');
        errorModal.id = 'uploadErrorModal';
        errorModal.innerHTML = `
            <div class="upload-error-content">
                <div class="upload-error-icon"><img src="/static/img/Error.png" class="error-img" alt=""></div>
                <h3>Upload Gagal</h3>
                <p>${errorMessage}</p>
                <div class="upload-error-actions">
                    <button id="retryUploadBtn" class="btn-retry"><img src="/static/img/Retry.png" class="btn-icon" alt=""> Coba Lagi</button>
                    <button id="saveLocalBtn" class="btn-save-local"><img src="/static/img/Folder.png" class="btn-icon" alt=""> Simpan Lokal</button>
                </div>
            </div>
        `;
        errorModal.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 100000;
        `;
        document.body.appendChild(errorModal);

        // Add styles
        const style = document.createElement('style');
        style.id = 'uploadErrorStyles';
        if (!document.getElementById('uploadErrorStyles')) {
            style.textContent = `
                .upload-error-content {
                    background: white;
                    padding: 40px 50px;
                    border-radius: 20px;
                    text-align: center;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
                    max-width: 400px;
                }
                .upload-error-icon { font-size: 50px; margin-bottom: 15px; }
                .upload-error-content h3 { color: #333; margin: 0 0 10px 0; font-size: 22px; font-family: 'Poppins', sans-serif; }
                .upload-error-content p { color: #666; margin: 0 0 25px 0; font-size: 14px; font-family: 'Poppins', sans-serif; }
                .upload-error-actions { display: flex; gap: 12px; justify-content: center; }
                .btn-retry {
                    background: #5969F2; color: white; border: none;
                    padding: 12px 24px; border-radius: 10px; font-size: 15px;
                    font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif;
                }
                .btn-retry:hover { background: #4858e0; }
                .btn-save-local {
                    background: #f0f0f0; color: #333; border: none;
                    padding: 12px 24px; border-radius: 10px; font-size: 15px;
                    font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif;
                }
                .btn-save-local:hover { background: #e0e0e0; }
            `;
            document.head.appendChild(style);
        }

        // Retry button
        document.getElementById('retryUploadBtn').addEventListener('click', () => {
            errorModal.remove();
            pendingMedia = mediaData;
            handleCloudUpload();
        });

        // Save local button
        document.getElementById('saveLocalBtn').addEventListener('click', () => {
            errorModal.remove();
            showToast(`${mediaData.type === 'screenshot' ? 'Screenshot' : 'Rekaman'} tersimpan di lokal`, "success");
        });
    }

    // Handle local save choice (already saved by Python, just show confirmation)
    async function handleLocalSave() {
        if (!pendingMedia) return;

        const { type } = pendingMedia;
        hideStorageModal();

        showToast(`${type === 'screenshot' ? 'Screenshot' : 'Rekaman'} tersimpan lokal!`, "success");
    }

    // Bind modal buttons
    if (storageCloudBtn) storageCloudBtn.addEventListener('click', handleCloudUpload);
    if (storageLocalBtn) storageLocalBtn.addEventListener('click', handleLocalSave);

    // Take screenshot using Python OpenCV
    async function takeScreenshot() {
        if (!state.usgSharing && !state.remoteUsgSharing) {
            showToast("Tidak ada USG yang aktif untuk di-screenshot", "error");
            return;
        }

        // If receiving remote USG, request screenshot from the sharer
        if (state.remoteUsgSharing && !state.usgSharing) {
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN && state.peerId) {
                showToast("Meminta screenshot dari pengirim USG...", "loading", 0);
                ctx.ws.send(JSON.stringify({
                    action: "request-screenshot",
                    target: state.peerId,
                    roomID: roomID
                }));
            } else {
                showToast("Tidak dapat menghubungi pengirim USG", "error");
            }
            return;
        }

        try {
            // Ensure patient record exists
            await ensurePatientRecord();

            // Flash effect
            flashScreen();

            // Call Python to take screenshot (local USG sharing)
            const result = await window.electronAPI.pythonScreenshot(roomID);

            if (result.success && result.path) {
                console.log("📸 Python screenshot saved:", result.path);

                // Extract filename from path
                const filename = result.path.split(/[/\\]/).pop();

                // Read the image file and open caliper modal
                try {
                    const imageData = await window.electronAPI.readFileAsDataUrl(result.path);
                    if (imageData && ctx.caliper) {
                        // Convert data URL to blob for saving later
                        const response = await fetch(imageData);
                        const blob = await response.blob();

                        // Set up caliper callbacks for save/upload
                        ctx.caliper.setSaveCallback(async (annotatedBlob, measurements) => {
                            // Overwrite original file with annotated image
                            try {
                                const arrayBuffer = await annotatedBlob.arrayBuffer();
                                const buffer = Array.from(new Uint8Array(arrayBuffer));
                                await window.electronAPI.saveAnnotatedImage(result.path, buffer);
                                showToast("Screenshot dengan pengukuran disimpan!", "success");
                                console.log("📏 Measurements:", measurements);
                            } catch (saveErr) {
                                console.error("Error saving annotated image:", saveErr);
                                showToast("Gagal menyimpan gambar!", "error");
                            }
                        });

                        ctx.caliper.setUploadCallback(async (annotatedBlob, measurements) => {
                            // First save the annotated image to local file
                            try {
                                const arrayBuffer = await annotatedBlob.arrayBuffer();
                                const buffer = Array.from(new Uint8Array(arrayBuffer));
                                await window.electronAPI.saveAnnotatedImage(result.path, buffer);
                            } catch (saveErr) {
                                console.error("Error saving annotated image before upload:", saveErr);
                            }

                            // Set pendingMedia for handleCloudUpload
                            pendingMedia = {
                                type: 'screenshot',
                                filePath: result.path,
                                filename: filename,
                                measurements: measurements
                            };
                            await handleCloudUpload();
                        });

                        // Set up cancel callback to delete original file
                        ctx.caliper.setCancelCallback(async () => {
                            try {
                                await window.electronAPI.deleteLocalFile(roomID, 'screenshots', filename);
                                console.log("🗑️ Cancelled screenshot deleted");
                            } catch (delErr) {
                                console.log("Delete failed (may already be deleted):", delErr);
                            }
                        });

                        // Open caliper modal with the screenshot
                        ctx.caliper.open(imageData, blob);
                    } else {
                        // Fallback to old flow if caliper not available
                        showStorageChoice('screenshot', result.path, filename);
                    }
                } catch (readErr) {
                    console.log("Caliper not available, using storage choice:", readErr);
                    showStorageChoice('screenshot', result.path, filename);
                }
            } else {
                throw new Error(result.error || "Screenshot failed");
            }

        } catch (err) {
            console.error("Screenshot error:", err);
            showToast("Gagal mengambil screenshot: " + err.message, "error");
        }
    }

    // Flash effect for screenshot
    function flashScreen() {
        const flash = document.createElement("div");
        flash.style.cssText = `
      position: fixed; inset: 0; background: white; opacity: 0.8;
      pointer-events: none; z-index: 99999;
      animation: flash-fade 0.3s ease-out forwards;
    `;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 300);
    }

    // Start recording using Python OpenCV
    async function startRecording() {
        if ((!state.usgSharing && !state.remoteUsgSharing) || isRecording) return;

        // If receiving remote USG, request recording from the sharer
        if (state.remoteUsgSharing && !state.usgSharing) {
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN && state.peerId) {
                showToast("Meminta rekaman dari pengirim USG...", "loading", 0);
                ctx.ws.send(JSON.stringify({
                    action: "request-start-recording",
                    target: state.peerId,
                    roomID: roomID
                }));
            } else {
                showToast("Tidak dapat menghubungi pengirim USG", "error");
            }
            return;
        }

        try {
            // Ensure patient record exists
            await ensurePatientRecord();

            const result = await window.electronAPI.pythonStartRecording(roomID, 'original');

            if (result.success) {
                isRecording = true;
                startTimer();

                if (recordingIndicator) recordingIndicator.classList.remove("hidden");
                const img = btnRecord?.querySelector("img");
                if (img) img.src = "/static/img/Stop Record.png";
                if (btnRecord) {
                    btnRecord.title = "Stop Recording";
                    btnRecord.classList.add("recording");
                }

                // Notify peer that recording started
                if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN && state.peerId) {
                    ctx.ws.send(JSON.stringify({
                        action: "recording-state",
                        target: state.peerId,
                        isRecording: true
                    }));
                }

                console.log("🎥 Python recording started:", result.path);
            } else {
                throw new Error(result.error || "Failed to start recording");
            }
        } catch (err) {
            console.error("Start recording error:", err);
            showToast("Gagal memulai rekaman: " + err.message, "error");
        }
    }

    // Stop recording using Python OpenCV
    async function stopRecording() {
        // Client B (receiving remote USG) - send stop request to sharer
        if (isRemoteRecording && !isRecording && state.remoteUsgSharing) {
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN && state.peerId) {
                showToast("Menghentikan rekaman...", "loading", 0);
                ctx.ws.send(JSON.stringify({
                    action: "request-stop-recording",
                    target: state.peerId,
                    roomID: roomID
                }));
            }
            return;
        }

        if (!isRecording) return;

        try {
            const result = await window.electronAPI.pythonStopRecording();

            isRecording = false;
            stopTimer();

            if (recordingIndicator) recordingIndicator.classList.add("hidden");
            const img = btnRecord?.querySelector("img");
            if (img) img.src = "/static/img/Start Record.png";
            if (btnRecord) {
                btnRecord.title = "Record USG";
                btnRecord.classList.remove("recording");
            }

            // Notify peer that recording stopped
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN && state.peerId) {
                ctx.ws.send(JSON.stringify({
                    action: "recording-state",
                    target: state.peerId,
                    isRecording: false
                }));
            }

            if (result.success && result.path) {
                console.log("🎥 Python recording stopped:", result.path);

                // Extract filename from path
                const filename = result.path.split(/[/\\]/).pop();

                // Show storage choice for recording
                showStorageChoice('recording', result.path, filename);
            } else {
                throw new Error(result.error || "Failed to stop recording");
            }
        } catch (err) {
            console.error("Stop recording error:", err);
            showToast("Gagal menghentikan rekaman: " + err.message, "error");
        }
    }

    // Toggle recording
    function toggleRecording() {
        if (isRecording) stopRecording();
        else startRecording();
    }

    // Event bindings
    if (btnScreenshot) btnScreenshot.addEventListener("click", takeScreenshot);
    if (btnRecord) btnRecord.addEventListener("click", toggleRecording);

    // Add flash and toast animation styles
    const style = document.createElement("style");
    style.textContent = `
    @keyframes flash-fade {
      from { opacity: 0.8; }
      to { opacity: 0; }
    }
    @keyframes toast-slide-up {
      from { transform: translateX(-50%) translateY(100px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    @keyframes toast-slide-down {
      from { transform: translateX(-50%) translateY(0); opacity: 1; }
      to { transform: translateX(-50%) translateY(100px); opacity: 0; }
    }
  `;
    document.head.appendChild(style);

    // Handler for remote screenshot request (executed on USG sharer's side)
    async function handleRemoteScreenshotRequest(fromId) {
        if (!state.usgSharing) {
            // Not sharing USG, cannot take screenshot
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "screenshot-result",
                    target: fromId,
                    success: false,
                    error: "USG tidak aktif"
                }));
            }
            return;
        }

        try {
            await ensurePatientRecord();
            flashScreen();
            const result = await window.electronAPI.pythonScreenshot(roomID);

            if (result.success && result.path) {
                const filename = result.path.split(/[/\\]/).pop();

                // Upload to cloud as temp (don't save to Firebase yet - receiver will do that after caliper)
                const mediaFolder = 'screenshots';
                const response = await fetch(`/savedata/${roomID}/${mediaFolder}/${filename}`);
                const blob = await response.blob();
                const file = new File([blob], filename, { type: blob.type });

                const cloudinaryData = await uploadToCloudinary(file, mediaFolder, 'image');

                // Send temp URL back to receiver for caliper editing
                if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                    ctx.ws.send(JSON.stringify({
                        action: "screenshot-result",
                        target: fromId,
                        success: true,
                        tempUrl: cloudinaryData.secure_url,
                        publicId: cloudinaryData.public_id,
                        filename: filename
                    }));
                }

                // Delete local file after upload
                if (window.electronAPI) {
                    try {
                        await window.electronAPI.deleteLocalFile(roomID, mediaFolder, filename);
                    } catch (e) { }
                }
            } else {
                throw new Error(result.error || "Screenshot failed");
            }
        } catch (err) {
            console.error("Remote screenshot error:", err);
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "screenshot-result",
                    target: fromId,
                    success: false,
                    error: err.message
                }));
            }
        }
    }

    // Handler for screenshot result (received by requestor - opens caliper)
    async function handleScreenshotResult(data) {
        if (data.success && data.tempUrl) {
            showToast("Screenshot diterima, membuka caliper...", "success");

            // Store temp cloud info for cleanup/save later
            pendingRemoteScreenshot = {
                tempUrl: data.tempUrl,
                publicId: data.publicId,
                filename: data.filename
            };

            // Open caliper with the temp cloud image URL
            if (ctx.caliper) {
                ctx.caliper.openWithImageUrl(data.tempUrl, async (annotatedBlob) => {
                    // User saved with annotations - upload annotated version to cloud
                    try {
                        showToast("Menyimpan screenshot dengan caliper...", "loading", 0);

                        // Upload annotated image (will replace or create new)
                        const annotatedFile = new File([annotatedBlob], data.filename, { type: 'image/png' });
                        const cloudinaryData = await uploadToCloudinary(annotatedFile, 'screenshots', 'image');
                        await saveMediaReference('screenshots', cloudinaryData);

                        // Delete the temp image if it's different
                        if (data.publicId && data.publicId !== cloudinaryData.public_id) {
                            try {
                                await fetch("/api/cloudinary-delete", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ publicIds: [data.publicId], resourceType: "image" })
                                });
                            } catch (e) { }
                        }

                        showToast("Screenshot dengan caliper tersimpan ke cloud!", "success");
                    } catch (err) {
                        console.error("Error saving annotated screenshot:", err);
                        showToast("Gagal menyimpan screenshot: " + err.message, "error");
                    }
                    pendingRemoteScreenshot = null;
                }, () => {
                    // User cancelled - delete temp cloud image
                    if (data.publicId) {
                        fetch("/api/cloudinary-delete", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ publicIds: [data.publicId], resourceType: "image" })
                        }).catch(console.warn);
                    }
                    showToast("Screenshot dibatalkan", "info");
                    pendingRemoteScreenshot = null;
                });
            } else {
                showToast("Caliper tidak tersedia", "error");
            }
        } else {
            showToast("Gagal mengambil screenshot: " + (data.error || "Unknown error"), "error");
        }
    }

    // Track pending remote screenshot for cleanup
    let pendingRemoteScreenshot = null;

    // Handler for remote start recording request
    async function handleRemoteStartRecordingRequest(fromId) {
        if (!state.usgSharing || isRecording) {
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "recording-result",
                    target: fromId,
                    success: false,
                    error: isRecording ? "Rekaman sudah berjalan" : "USG tidak aktif"
                }));
            }
            return;
        }

        try {
            await ensurePatientRecord();
            const result = await window.electronAPI.pythonStartRecording(roomID, 'original');

            if (result.success) {
                isRecording = true;
                startTimer();
                if (recordingIndicator) recordingIndicator.classList.remove("hidden");
                const img = btnRecord?.querySelector("img");
                if (img) img.src = "/static/img/Stop Record.png";
                if (btnRecord) {
                    btnRecord.title = "Stop Recording";
                    btnRecord.classList.add("recording");
                }

                if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                    ctx.ws.send(JSON.stringify({
                        action: "recording-result",
                        target: fromId,
                        success: true,
                        started: true
                    }));
                }
            } else {
                throw new Error(result.error || "Failed to start recording");
            }
        } catch (err) {
            console.error("Remote recording error:", err);
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "recording-result",
                    target: fromId,
                    success: false,
                    error: err.message
                }));
            }
        }
    }

    // Handler for recording result
    function handleRecordingResult(data) {
        if (data.success) {
            if (data.started) {
                showToast("Rekaman dimulai oleh pengirim USG", "success");
                // Update UI to show recording state
                isRemoteRecording = true;
                startTimer(); // Start timer on Client B
                if (recordingIndicator) recordingIndicator.classList.remove("hidden");
                const img = btnRecord?.querySelector("img");
                if (img) img.src = "/static/img/Stop Record.png";
                if (btnRecord) {
                    btnRecord.title = "Stop Recording";
                    btnRecord.classList.add("recording");
                }
            } else {
                showToast("Rekaman dihentikan dan tersimpan", "success");
                // Reset UI
                isRemoteRecording = false;
                stopTimer(); // Stop timer on Client B
                if (recordingIndicator) recordingIndicator.classList.add("hidden");
                const img = btnRecord?.querySelector("img");
                if (img) img.src = "/static/img/Start Record.png";
                if (btnRecord) {
                    btnRecord.title = "Record USG";
                    btnRecord.classList.remove("recording");
                }
            }
        } else {
            showToast("Gagal: " + (data.error || "Unknown error"), "error");
        }
    }

    // Handler for recording state sync from peer
    function handleRecordingState(data) {
        isRemoteRecording = data.isRecording;

        if (data.isRecording) {
            startTimer(); // Start timer on Client B
            if (recordingIndicator) recordingIndicator.classList.remove("hidden");
            const img = btnRecord?.querySelector("img");
            if (img) img.src = "/static/img/Stop Record.png";
            if (btnRecord) {
                btnRecord.title = "Stop Recording";
                btnRecord.classList.add("recording");
            }
            showToast("Rekaman dimulai oleh peer", "success");
        } else {
            stopTimer(); // Stop timer on Client B
            if (recordingIndicator) recordingIndicator.classList.add("hidden");
            const img = btnRecord?.querySelector("img");
            if (img) img.src = "/static/img/Start Record.png";
            if (btnRecord) {
                btnRecord.title = "Record USG";
                btnRecord.classList.remove("recording");
            }
            showToast("Rekaman dihentikan oleh peer", "info");
        }
    }

    // Handler for remote stop recording request
    async function handleRemoteStopRecordingRequest(fromId) {
        if (!isRecording) {
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "recording-result",
                    target: fromId,
                    success: false,
                    error: "Tidak ada rekaman aktif"
                }));
            }
            return;
        }

        // Stop recording on this machine (Client A)
        try {
            const result = await window.electronAPI.pythonStopRecording();

            isRecording = false;
            stopTimer();

            if (recordingIndicator) recordingIndicator.classList.add("hidden");
            const img = btnRecord?.querySelector("img");
            if (img) img.src = "/static/img/Start Record.png";
            if (btnRecord) {
                btnRecord.title = "Record USG";
                btnRecord.classList.remove("recording");
            }

            if (result.success && result.path) {
                const filename = result.path.split(/[/\\]/).pop();

                // Store pending recording info for when Client B sends storage choice
                pendingRemoteRecording = {
                    fromId: fromId,
                    filePath: result.path,
                    filename: filename
                };

                showToast("Menunggu pilihan penyimpanan dari peer...", "loading", 0);

                // Send file info back to Client B so they can show storage popup
                if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                    ctx.ws.send(JSON.stringify({
                        action: "recording-stopped",
                        target: fromId,
                        success: true,
                        filename: filename,
                        fileSize: result.size || 0
                    }));
                }
            } else {
                throw new Error(result.error || "Failed to stop recording");
            }
        } catch (err) {
            console.error("Remote stop recording error:", err);
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "recording-result",
                    target: fromId,
                    success: false,
                    error: err.message
                }));
            }
        }
    }

    // Pending recording from remote stop (waiting for storage choice)
    let pendingRemoteRecording = null;

    // Handler for storage choice from Client B
    async function handleRecordingStorageChoice(data) {
        if (!pendingRemoteRecording) {
            console.warn("No pending remote recording");
            return;
        }

        const { filePath, filename, fromId } = pendingRemoteRecording;
        pendingRemoteRecording = null;

        if (data.storageType === 'cloud') {
            // Upload to cloud
            showToast("Mengupload rekaman ke cloud...", "loading", 0);

            try {
                const response = await fetch(`/savedata/${roomID}/recordings/${filename}`);
                const blob = await response.blob();
                const file = new File([blob], filename, { type: blob.type });

                const cloudinaryData = await uploadToCloudinary(file, 'recordings', 'video');
                await saveMediaReference('recordings', cloudinaryData);

                // Delete local file after cloud upload
                if (window.electronAPI) {
                    try {
                        await window.electronAPI.deleteLocalFile(roomID, 'recordings', filename);
                    } catch (e) { }
                }

                showToast("Rekaman tersimpan ke cloud!", "success");

                // Notify Client B of success
                if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                    ctx.ws.send(JSON.stringify({
                        action: "recording-result",
                        target: fromId,
                        success: true,
                        started: false,
                        storageType: 'cloud'
                    }));
                }
            } catch (uploadErr) {
                console.error("Cloud upload failed:", uploadErr);
                showToast("Gagal upload ke cloud: " + uploadErr.message, "error");

                if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                    ctx.ws.send(JSON.stringify({
                        action: "recording-result",
                        target: fromId,
                        success: false,
                        error: uploadErr.message
                    }));
                }
            }
        } else {
            // Keep local (file is already saved locally)
            showToast("Rekaman tersimpan lokal!", "success");

            // Notify Client B of success
            if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
                ctx.ws.send(JSON.stringify({
                    action: "recording-result",
                    target: fromId,
                    success: true,
                    started: false,
                    storageType: 'local'
                }));
            }
        }
    }

    // Toggle recording
    function toggleRecording() {
        if (isRecording || isRemoteRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    // Handler for recording stopped message (received by Client B - shows storage popup)
    function handleRecordingStopped(data) {
        if (data.success) {
            // Stop timer and update UI on Client B
            stopTimer();
            isRemoteRecording = false;
            if (recordingIndicator) recordingIndicator.classList.add("hidden");
            const img = btnRecord?.querySelector("img");
            if (img) img.src = "/static/img/Start Record.png";
            if (btnRecord) {
                btnRecord.title = "Record USG";
                btnRecord.classList.remove("recording");
            }

            // Store info for sending storage choice back
            pendingStorageChoice = {
                fromId: data.from,
                filename: data.filename
            };

            // Show storage popup on Client B
            showStorageChoiceForRemote(data.filename, data.fileSize);
        } else {
            showToast("Gagal menghentikan rekaman: " + (data.error || "Unknown"), "error");
        }
    }

    let pendingStorageChoice = null;

    // Show storage choice popup for remote recording (on Client B)
    function showStorageChoiceForRemote(filename, fileSize) {
        if (!storageModal) return;

        if (storageModalText) {
            storageModalText.textContent = `Rekaman "${filename}" selesai. Pilih lokasi penyimpanan:`;
        }

        // Update storage usage display (will be updated to per-room later)
        if (storageUsageText) {
            const usedMB = (currentStorageUsage / (1024 * 1024)).toFixed(1);
            const limitMB = (CLOUD_LIMIT_BYTES / (1024 * 1024)).toFixed(0);
            storageUsageText.textContent = `Penyimpanan: ${usedMB}/${limitMB} MB`;
        }

        storageModal.classList.remove("hidden");

        // Remove old listeners and add new ones for remote
        const newCloudBtn = storageCloudBtn?.cloneNode(true);
        const newLocalBtn = storageLocalBtn?.cloneNode(true);
        const newCancelBtn = storageCancelBtn?.cloneNode(true);

        if (storageCloudBtn && newCloudBtn) {
            storageCloudBtn.parentNode?.replaceChild(newCloudBtn, storageCloudBtn);
            newCloudBtn.addEventListener('click', () => {
                storageModal.classList.add("hidden");
                sendStorageChoice('cloud');
            });
        }

        if (storageLocalBtn && newLocalBtn) {
            storageLocalBtn.parentNode?.replaceChild(newLocalBtn, storageLocalBtn);
            newLocalBtn.addEventListener('click', () => {
                storageModal.classList.add("hidden");
                sendStorageChoice('local');
            });
        }

        if (storageCancelBtn && newCancelBtn) {
            storageCancelBtn.parentNode?.replaceChild(newCancelBtn, storageCancelBtn);
            newCancelBtn.addEventListener('click', () => {
                storageModal.classList.add("hidden");
                // Default to local if cancelled
                sendStorageChoice('local');
            });
        }
    }

    // Send storage choice back to Client A
    function sendStorageChoice(storageType) {
        if (!pendingStorageChoice) {
            console.warn("No pending storage choice");
            return;
        }

        showToast(storageType === 'cloud' ? "Menyimpan ke cloud..." : "Menyimpan lokal...", "loading", 0);

        if (ctx.ws && ctx.ws.readyState === WebSocket.OPEN) {
            ctx.ws.send(JSON.stringify({
                action: "recording-storage-choice",
                target: pendingStorageChoice.fromId,
                storageType: storageType
            }));
        }

        pendingStorageChoice = null;
    }

    return {
        takeScreenshot,
        startRecording,
        stopRecording,
        toggleRecording,
        handleRemoteScreenshotRequest,
        handleScreenshotResult,
        handleRemoteStartRecordingRequest,
        handleRemoteStopRecordingRequest,
        handleRecordingResult,
        handleRecordingState,
        handleRecordingStopped,
        handleRecordingStorageChoice,
        cleanup() {
            if (isRecording) stopRecording();
        }
    };
}


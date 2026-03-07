// patients.js - Patient data management with cloud media
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, onValue, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { initSessionTimeout } from "./session-timeout.js";
import { showToast } from "./toast.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Initialize session timeout (30 min inactivity = auto logout)
initSessionTimeout(auth, signOut);

// Auth check
onAuthStateChanged(auth, async (user) => {
    // Dev mode bypass - can see ALL patients
    if (sessionStorage.getItem("devMode") === "true") {
        document.getElementById("userName").textContent = "Admin (Dev)";
        loadPatients(true); // true = load all patients
        return;
    }

    if (!user) location.href = "/login";
    else {
        document.getElementById("userName").textContent = user.displayName || "User";
        loadPatients(false); // false = load only user's patients
    }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
    location.href = "/login";
});

// DOM
const patientsList = document.getElementById("patientsList");
const searchInput = document.getElementById("searchInput");
const patientModal = document.getElementById("patientModal");
const closeModal = document.getElementById("closeModal");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxDownload = document.getElementById("lightboxDownload");

// Batch mode elements
const batchActionBar = document.getElementById("batchActionBar");
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const selectedCountEl = document.getElementById("selectedCount");
const batchExportBtn = document.getElementById("batchExportBtn");
const batchDeleteBtn = document.getElementById("batchDeleteBtn");
const batchCancelBtn = document.getElementById("batchCancelBtn");

let allPatients = [];
let batchMode = false;
let selectedPatients = new Set();

// Helper function to get user ID for Firebase references
function getUserId() {
    const isDevMode = sessionStorage.getItem("devMode") === "true";
    if (isDevMode) return "dev";
    const user = auth.currentUser;
    return user?.uid || null;
}

// Load patients from Firebase (room-based, filtered by participation)
async function loadPatients(loadAll = false) {
    patientsList.innerHTML = '<p class="loading-text">Memuat data pasien...</p>';

    try {
        allPatients = [];
        const userId = getUserId();
        const isDevMode = sessionStorage.getItem("devMode") === "true";

        // Admin (dev mode) always sees all rooms
        const shouldLoadAll = loadAll || isDevMode;

        console.log("📋 Loading patients for userId:", userId, "loadAll:", shouldLoadAll, "isDevMode:", isDevMode);

        if (!userId && !shouldLoadAll) {
            patientsList.innerHTML = '<p class="error-text">Silakan login terlebih dahulu</p>';
            return;
        }

        // Query all rooms
        const roomsRef = ref(db, 'rooms');
        const snapshot = await get(roomsRef);

        if (snapshot.exists()) {
            snapshot.forEach((roomChild) => {
                const roomID = roomChild.key;
                const roomData = roomChild.val();

                // Check if user is a participant, creator, or in allowedUsers
                const participants = roomData.participants || {};
                const isParticipant = userId && participants[userId];
                const isCreator = roomData.notes?.createdBy === userId;
                const allowedUsers = roomData.notes?.allowedUsers || [];
                const isAllowed = userId && allowedUsers.includes(userId);

                // Check if room has content (notes or media)
                const hasNotes = !!roomData.notes;
                const hasMedia = !!(roomData.media && (roomData.media.screenshots || roomData.media.recordings));
                const hasContent = hasNotes || hasMedia;

                // Determine visibility:
                // - Admin (shouldLoadAll): sees all rooms with content
                // - Regular user: sees rooms where they are participant, creator, or in allowedUsers
                const canView = hasContent && (shouldLoadAll || isParticipant || isCreator || isAllowed);

                console.log(`📁 Room ${roomID}: hasContent=${hasContent}, isParticipant=${isParticipant}, isCreator=${isCreator}, isAllowed=${isAllowed}, canView=${canView}`);

                if (canView) {
                    allPatients.push({
                        roomID: roomID,
                        participants: Object.keys(participants),
                        host: roomData.host,
                        createdAt: roomData.createdAt,
                        ...(roomData.notes || { patient_name: "Pasien Baru", timestamp: roomData.createdAt })
                    });
                }
            });
        }

        console.log("📋 Total patients found:", allPatients.length);

        if (!allPatients.length) {
            patientsList.innerHTML = '<p class="no-data">Belum ada data pasien</p>';
            return;
        }

        // Sort by timestamp (newest first)
        allPatients.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

        renderPatientsList(allPatients);
    } catch (err) {
        console.error("Error loading patients:", err);
        patientsList.innerHTML = '<p class="error-text">Gagal memuat data pasien</p>';
    }
}

// Render patients list
function renderPatientsList(patients) {
    if (!patients.length) {
        patientsList.innerHTML = '<p class="no-data">Tidak ada data yang cocok</p>';
        return;
    }

    patientsList.innerHTML = patients.map(p => {
        const isSelected = selectedPatients.has(p.roomID);
        return `
        <div class="patient-card ${batchMode ? 'batch-mode' : ''} ${isSelected ? 'selected' : ''}" data-room="${p.roomID}">
          ${batchMode ? `<input type="checkbox" class="patient-checkbox" data-room="${p.roomID}" ${isSelected ? 'checked' : ''} />` : ''}
          <div class="patient-info">
            <h3>${p.patient_name || "Pasien"}</h3>
            <p class="patient-meta">
              <span><img src="/static/img/Calendar.png" class="inline-icon" alt=""> ${formatDate(p.timestamp)}</span>
              ${p.mother_age ? `<span><img src="/static/img/Person.png" class="inline-icon" alt=""> ${p.mother_age} tahun</span>` : ""}
              ${p.diagnosis ? `<span class="diagnosis-preview"><img src="/static/img/Diagnosis.png" class="inline-icon" alt=""> ${truncate(p.diagnosis, 50)}</span>` : ""}
            </p>
          </div>
          <div class="patient-actions">
            ${batchMode ? '' : `
              <button class="btn-view" onclick="openPatient('${p.roomID}')">Lihat Detail</button>
              <button class="btn-delete" onclick="deletePatient('${p.roomID}', '${(p.patient_name || 'Pasien').replace(/'/g, "\\'")}')"><img src="/static/img/Trashcan.png" class="btn-icon" alt=""> Hapus</button>
            `}
          </div>
        </div>
      `;
    }).join("");

    // Add checkbox click handlers in batch mode
    if (batchMode) {
        document.querySelectorAll('.patient-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const roomID = e.target.dataset.room;
                if (e.target.checked) {
                    selectedPatients.add(roomID);
                } else {
                    selectedPatients.delete(roomID);
                }
                updateSelectedCount();
                renderPatientsList(patients);
            });
        });

        // Click on card to toggle selection
        document.querySelectorAll('.patient-card.batch-mode').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('patient-checkbox')) return;
                const roomID = card.dataset.room;
                if (selectedPatients.has(roomID)) {
                    selectedPatients.delete(roomID);
                } else {
                    selectedPatients.add(roomID);
                }
                updateSelectedCount();
                renderPatientsList(patients);
            });
        });
    }
}

// Update selected count display
function updateSelectedCount() {
    if (selectedCountEl) {
        selectedCountEl.textContent = `${selectedPatients.size} dipilih`;
    }
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedPatients.size === allPatients.length && allPatients.length > 0;
    }
}

// Toggle batch mode
window.toggleBatchMode = () => {
    batchMode = !batchMode;
    selectedPatients.clear();
    if (batchMode) {
        batchActionBar?.classList.remove('hidden');
    } else {
        batchActionBar?.classList.add('hidden');
    }
    updateSelectedCount();
    renderPatientsList(allPatients);
};

// Select All checkbox handler
selectAllCheckbox?.addEventListener('change', (e) => {
    if (e.target.checked) {
        allPatients.forEach(p => selectedPatients.add(p.roomID));
    } else {
        selectedPatients.clear();
    }
    updateSelectedCount();
    renderPatientsList(allPatients);
});

// Cancel batch mode
batchCancelBtn?.addEventListener('click', () => {
    batchMode = false;
    selectedPatients.clear();
    batchActionBar?.classList.add('hidden');
    renderPatientsList(allPatients);
});

// Batch Delete Handler
batchDeleteBtn?.addEventListener('click', () => {
    if (selectedPatients.size === 0) {
        showToast("Pilih minimal satu pasien", "error");
        return;
    }

    const count = selectedPatients.size;

    // Show themed confirmation modal
    showBatchDeleteModal(count);
});

// Themed batch delete confirmation modal
function showBatchDeleteModal(count) {
    // Remove existing modal if any
    const existingModal = document.getElementById('batchDeleteModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'batchDeleteModal';
    modal.innerHTML = `
        <div class="batch-delete-modal-content">
            <div class="batch-delete-icon"><img src="/static/img/Trashcan.png" alt="" style="width:48px;height:48px;"></div>
            <h3>Hapus ${count} Data Pasien?</h3>
            <p>Semua data termasuk screenshot dan rekaman akan dihapus permanen.</p>
            <p class="batch-delete-warning"><img src="/static/img/Warning.png" class="inline-icon" alt=""> Tindakan ini tidak dapat dibatalkan.</p>
            <div class="batch-delete-actions">
                <button id="batchDeleteCancelBtn" class="btn-batch-modal-cancel">Batal</button>
                <button id="batchDeleteConfirmBtn" class="btn-batch-modal-confirm">Hapus ${count} Pasien</button>
            </div>
        </div>
    `;
    modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 1000; animation: fade-in 0.2s ease-out;
    `;
    document.body.appendChild(modal);

    // Add modal styles
    if (!document.getElementById('batchDeleteModalStyles')) {
        const style = document.createElement('style');
        style.id = 'batchDeleteModalStyles';
        style.textContent = `
            @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes modal-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .batch-delete-modal-content {
                background: white;
                padding: 35px 45px;
                border-radius: 20px;
                text-align: center;
                max-width: 420px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.25);
                animation: modal-pop 0.2s ease-out;
            }
            .batch-delete-icon { font-size: 50px; margin-bottom: 15px; }
            .batch-delete-modal-content h3 { 
                font-size: 20px; font-weight: 600; margin: 0 0 10px 0; 
                color: #333; font-family: 'Poppins', sans-serif; 
            }
            .batch-delete-modal-content p { 
                font-size: 14px; color: #666; margin: 0 0 8px 0; 
                font-family: 'Poppins', sans-serif; 
            }
            .batch-delete-warning { color: #E33434 !important; font-size: 13px !important; margin-bottom: 20px !important; }
            .batch-delete-actions { display: flex; gap: 12px; justify-content: center; margin-top: 20px; }
            .btn-batch-modal-cancel {
                background: #f0f0f0; color: #333; border: none;
                padding: 12px 28px; border-radius: 10px;
                font-size: 14px; font-weight: 500; cursor: pointer;
                font-family: 'Poppins', sans-serif; transition: 0.2s;
            }
            .btn-batch-modal-cancel:hover { background: #e0e0e0; }
            .btn-batch-modal-confirm {
                background: #E33434; color: white; border: none;
                padding: 12px 28px; border-radius: 10px;
                font-size: 14px; font-weight: 500; cursor: pointer;
                font-family: 'Poppins', sans-serif; transition: 0.2s;
            }
            .btn-batch-modal-confirm:hover { background: #c42727; }
        `;
        document.head.appendChild(style);
    }

    // Cancel button
    document.getElementById('batchDeleteCancelBtn').addEventListener('click', () => {
        modal.remove();
    });

    // Backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    // Confirm button - execute delete
    document.getElementById('batchDeleteConfirmBtn').addEventListener('click', async () => {
        modal.remove();
        await executeBatchDelete();
    });
}

// Execute batch delete
async function executeBatchDelete() {
    const count = selectedPatients.size;
    showToast(`Menghapus ${count} pasien...`, "info", 5000);

    const user = auth.currentUser;
    const isDevMode = sessionStorage.getItem("devMode") === "true";

    // Allow both logged-in users and dev mode (admin)
    if (!user && !isDevMode) {
        showToast("Silakan login terlebih dahulu", "error");
        return;
    }

    let deleted = 0;
    for (const roomID of selectedPatients) {
        try {
            // Get and delete cloud media
            const screenshotsRef = ref(db, `rooms/${roomID}/media/screenshots`);
            const recordingsRef = ref(db, `rooms/${roomID}/media/recordings`);
            const screenshotsSnap = await get(screenshotsRef);
            const recordingsSnap = await get(recordingsRef);

            const imagePublicIds = [];
            const videoPublicIds = [];

            if (screenshotsSnap.val()) {
                Object.values(screenshotsSnap.val()).forEach(s => {
                    if (s.publicId) imagePublicIds.push(s.publicId);
                });
            }
            if (recordingsSnap.val()) {
                Object.values(recordingsSnap.val()).forEach(r => {
                    if (r.publicId) videoPublicIds.push(r.publicId);
                });
            }

            // Delete from Cloudinary
            if (imagePublicIds.length > 0) {
                await fetch("/api/cloudinary-delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ publicIds: imagePublicIds, resourceType: "image" })
                });
            }
            if (videoPublicIds.length > 0) {
                await fetch("/api/cloudinary-delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ publicIds: videoPublicIds, resourceType: "video" })
                });
            }

            // Delete room folder from Cloudinary (including subfolders)
            await fetch("/api/cloudinary-delete-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomID })
            });

            // Delete entire room from Firebase (includes notes, chats, media references)
            await remove(ref(db, `rooms/${roomID}`));

            // Delete local files
            if (window.electronAPI) {
                await window.electronAPI.deleteLocalFolder(roomID);
            }

            deleted++;
        } catch (err) {
            console.error(`Error deleting patient ${roomID}:`, err);
        }
    }

    // Update UI
    allPatients = allPatients.filter(p => !selectedPatients.has(p.roomID));
    selectedPatients.clear();
    batchMode = false;
    batchActionBar?.classList.add('hidden');
    renderPatientsList(allPatients);
    showToast(`${deleted} pasien berhasil dihapus`, "success");
}

// Batch Export PDF Handler - Using same format as single export
batchExportBtn?.addEventListener('click', async () => {
    if (selectedPatients.size === 0) {
        showToast("Pilih minimal satu pasien", "error");
        return;
    }

    const count = selectedPatients.size;
    showToast(`Generating ${count} PDF files...`, "info", 3000);

    const { jsPDF } = window.jspdf;

    for (const roomID of selectedPatients) {
        const patient = allPatients.find(p => p.roomID === roomID);
        if (!patient) continue;

        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.getWidth();
            let yPos = 20;

            // Header
            doc.setFontSize(20);
            doc.setFont("helvetica", "bold");
            doc.text("Laporan Pemeriksaan USG", pageWidth / 2, yPos, { align: "center" });
            yPos += 10;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text("Tele-USG Medical Report", pageWidth / 2, yPos, { align: "center" });
            yPos += 15;

            doc.setFontSize(10);
            doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`, 14, yPos);
            yPos += 10;

            doc.setLineWidth(0.5);
            doc.line(14, yPos, pageWidth - 14, yPos);
            yPos += 10;

            // Patient Info Section
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("Data Pasien", 14, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const patientInfo = [
                ["Nama", patient.patient_name || "-"],
                ["Usia", patient.mother_age ? `${patient.mother_age} tahun` : "-"],
                ["Gravida/Para", `${patient.gravida || "-"}/${patient.para || "-"}`],
                ["HPHT (LMP)", patient.lmp || "-"],
                ["HPL (EDD)", patient.edd || "-"]
            ];

            patientInfo.forEach(([label, value]) => {
                doc.text(`${label}: ${value}`, 14, yPos);
                yPos += 6;
            });
            yPos += 5;

            // Biometry Section
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("Biometri Janin", 14, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const biometry = [
                ["BPD", `${patient.bpd || "-"} mm`],
                ["HC", `${patient.hc || "-"} mm`],
                ["AC", `${patient.ac || "-"} mm`],
                ["FL", `${patient.fl || "-"} mm`],
                ["EFW", `${patient.efw || "-"} g`]
            ];

            let col = 0;
            biometry.forEach(([label, value]) => {
                const xPos = col === 0 ? 14 : 100;
                doc.text(`${label}: ${value}`, xPos, yPos);
                col++;
                if (col >= 2) { col = 0; yPos += 6; }
            });
            if (col !== 0) yPos += 6;
            yPos += 5;

            // Fetal Assessment
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("Penilaian Janin", 14, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const fetal = [
                ["FHR", `${patient.fhr || "-"} bpm`],
                ["Presentasi", patient.presentation || "-"],
                ["Gerakan", patient.movement || "-"]
            ];
            fetal.forEach(([label, value]) => {
                doc.text(`${label}: ${value}`, 14, yPos);
                yPos += 6;
            });
            yPos += 5;

            // Diagnosis
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("Diagnosis", 14, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const diagLines = doc.splitTextToSize(patient.diagnosis || "-", pageWidth - 28);
            doc.text(diagLines, 14, yPos);
            yPos += diagLines.length * 5 + 5;

            // Recommendations
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("Rekomendasi", 14, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const recLines = doc.splitTextToSize(patient.recommendations || "-", pageWidth - 28);
            doc.text(recLines, 14, yPos);
            yPos += recLines.length * 5 + 10;

            // Add Screenshots Section
            // Get screenshots from Firebase (room-scoped)
            const screenshotsRef = ref(db, `rooms/${roomID}/media/screenshots`);
            const screenshotsSnap = await get(screenshotsRef);
            const cloudScreenshots = screenshotsSnap.val() ? Object.values(screenshotsSnap.val()) : [];

            // Get local screenshots
            let localScreenshots = [];
            if (window.electronAPI) {
                try {
                    localScreenshots = await window.electronAPI.getLocalMediaList(roomID, 'screenshots');
                } catch (e) { }
            }

            const allScreenshots = [
                ...localScreenshots.map(s => ({ url: `/savedata/${roomID}/screenshots/${s.filename}`, source: 'local' })),
                ...cloudScreenshots.map(s => ({ url: s.url, source: 'cloud' }))
            ];

            if (allScreenshots.length > 0) {
                // Check if we need a new page for screenshots
                if (yPos > 200) {
                    doc.addPage();
                    yPos = 20;
                }

                doc.setFontSize(12);
                doc.setFont("helvetica", "bold");
                doc.text("Screenshot USG", 14, yPos);
                yPos += 10;

                // Fetch and add images (max 4 per PDF)
                const maxImages = Math.min(allScreenshots.length, 4);
                for (let i = 0; i < maxImages; i++) {
                    try {
                        const imgUrl = allScreenshots[i].url;
                        const response = await fetch(imgUrl);
                        const blob = await response.blob();

                        // Convert to base64
                        const base64 = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        });

                        // Check if we need a new page
                        if (yPos > 230) {
                            doc.addPage();
                            yPos = 20;
                        }

                        // Add image (80mm wide, 16:9 aspect ratio)
                        const imgWidth = 80;
                        const imgHeight = 45;
                        doc.addImage(base64, 'JPEG', 14, yPos, imgWidth, imgHeight);
                        yPos += imgHeight + 5;

                    } catch (imgErr) {
                        console.warn("Could not add image to PDF:", imgErr);
                    }
                }

                if (allScreenshots.length > maxImages) {
                    doc.setFontSize(9);
                    doc.setFont("helvetica", "italic");
                    doc.text(`+ ${allScreenshots.length - maxImages} more screenshots`, 14, yPos);
                }
            }

            const filename = `USG_${patient.patient_name || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(filename);

        } catch (err) {
            console.error(`Error exporting PDF for ${roomID}:`, err);
        }
    }

    showToast(`${count} PDF berhasil diexport!`, "success");
});

// Search filter
searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
        renderPatientsList(allPatients);
        return;
    }

    const filtered = allPatients.filter(p =>
        (p.patient_name || "").toLowerCase().includes(query) ||
        (p.diagnosis || "").toLowerCase().includes(query) ||
        (p.roomID || "").toLowerCase().includes(query)
    );
    renderPatientsList(filtered);
});

// Delete patient modal elements
const deleteModal = document.getElementById("deleteModal");
const deleteModalText = document.getElementById("deleteModalText");
const deleteCancelBtn = document.getElementById("deleteCancelBtn");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");

let pendingDeleteRoomID = null;

// Show delete confirmation modal
window.deletePatient = (roomID, patientName) => {
    pendingDeleteRoomID = roomID;
    deleteModalText.textContent = `Apakah Anda yakin ingin menghapus data pasien "${patientName}"?`;
    deleteModal.classList.remove("hidden");
};

// Cancel delete
deleteCancelBtn.addEventListener("click", () => {
    deleteModal.classList.add("hidden");
    pendingDeleteRoomID = null;
});

// Confirm delete
deleteConfirmBtn.addEventListener("click", async () => {
    if (!pendingDeleteRoomID) return;

    const roomID = pendingDeleteRoomID;
    deleteModal.classList.add("hidden");

    try {
        // Get cloud media to delete from Cloudinary
        const screenshotsRef = ref(db, `rooms/${roomID}/media/screenshots`);
        const recordingsRef = ref(db, `rooms/${roomID}/media/recordings`);

        const [screenshotsSnap, recordingsSnap] = await Promise.all([
            get(screenshotsRef),
            get(recordingsRef)
        ]);

        // Collect publicIds for Cloudinary deletion
        const imagePublicIds = [];
        const videoPublicIds = [];

        if (screenshotsSnap.exists()) {
            screenshotsSnap.forEach(child => {
                const data = child.val();
                if (data.publicId) imagePublicIds.push(data.publicId);
            });
        }

        if (recordingsSnap.exists()) {
            recordingsSnap.forEach(child => {
                const data = child.val();
                if (data.publicId) videoPublicIds.push(data.publicId);
            });
        }

        // Delete from Cloudinary (images)
        if (imagePublicIds.length > 0) {
            await fetch("/api/cloudinary-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ publicIds: imagePublicIds, resourceType: "image" })
            });
        }

        // Delete from Cloudinary (videos)
        if (videoPublicIds.length > 0) {
            await fetch("/api/cloudinary-delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ publicIds: videoPublicIds, resourceType: "video" })
            });
        }

        // Delete Cloudinary folder (cleanup empty room folder)
        if (imagePublicIds.length > 0 || videoPublicIds.length > 0) {
            try {
                await fetch("/api/cloudinary-delete-folder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ roomID })
                });
                console.log("✅ Cloudinary folder deleted for room:", roomID);
            } catch (folderErr) {
                console.warn("Could not delete Cloudinary folder:", folderErr);
            }
        }

        // Delete entire room from Firebase (includes notes, media, chats, participants)
        await remove(ref(db, `rooms/${roomID}`));

        // Delete local media folder
        if (window.electronAPI) {
            await window.electronAPI.deleteLocalFolder(roomID);
        }

        // Remove from local array and re-render
        allPatients = allPatients.filter(p => p.roomID !== roomID);
        renderPatientsList(allPatients);

        // Show success message
        showToast("Data pasien berhasil dihapus", "success");
    } catch (err) {
        console.error("Error deleting patient:", err);
        showToast("Gagal menghapus data pasien", "error");
    }

    pendingDeleteRoomID = null;
});

// Close modal on backdrop click
deleteModal.addEventListener("click", (e) => {
    if (e.target === deleteModal) {
        deleteModal.classList.add("hidden");
        pendingDeleteRoomID = null;
    }
});



// Open patient detail
window.openPatient = async (roomID) => {
    const patient = allPatients.find(p => p.roomID === roomID);
    if (!patient) return;

    document.getElementById("modalPatientName").textContent = patient.patient_name || "Detail Pasien";

    // Render patient info
    const infoGrid = document.getElementById("patientInfo");
    infoGrid.innerHTML = `
    <div class="info-section">
      <h4><img src="/static/img/Person.png" class="section-icon" alt=""> Data Pasien</h4>
      <div class="info-row"><span>Nama:</span><span>${patient.patient_name || "-"}</span></div>
      <div class="info-row"><span>Usia:</span><span>${patient.mother_age ? patient.mother_age + " tahun" : "-"}</span></div>
      <div class="info-row"><span>G/P:</span><span>${patient.gravida || "-"}/${patient.para || "-"}</span></div>
      <div class="info-row"><span>HPHT:</span><span>${patient.lmp || "-"}</span></div>
      <div class="info-row"><span>HPL:</span><span>${patient.edd || "-"}</span></div>
    </div>
    <div class="info-section">
      <h4><img src="/static/img/Ruler.png" class="section-icon" alt=""> Biometri Janin</h4>
      <div class="info-row"><span>BPD:</span><span>${patient.bpd || "-"} mm</span></div>
      <div class="info-row"><span>HC:</span><span>${patient.hc || "-"} mm</span></div>
      <div class="info-row"><span>AC:</span><span>${patient.ac || "-"} mm</span></div>
      <div class="info-row"><span>FL:</span><span>${patient.fl || "-"} mm</span></div>
      <div class="info-row"><span>EFW:</span><span>${patient.efw || "-"} g</span></div>
    </div>
    <div class="info-section">
      <h4><img src="/static/img/Heart.png" class="section-icon" alt=""> Penilaian Janin</h4>
      <div class="info-row"><span>FHR:</span><span>${patient.fhr || "-"} bpm</span></div>
      <div class="info-row"><span>Presentasi:</span><span>${patient.presentation || "-"}</span></div>
      <div class="info-row"><span>Gerakan:</span><span>${patient.movement || "-"}</span></div>
    </div>
    <div class="info-section full-width">
      <h4><img src="/static/img/Diagnosis.png" class="section-icon" alt=""> Diagnosis</h4>
      <p class="diagnosis-text">${patient.diagnosis || "-"}</p>
    </div>
    <div class="info-section full-width">
      <h4><img src="/static/img/Lightbulp.png" class="section-icon" alt=""> Rekomendasi</h4>
      <p class="diagnosis-text">${patient.recommendations || "-"}</p>
    </div>
  `;

    // Load media
    await loadPatientMedia(roomID);

    // Show modal
    patientModal.classList.remove("hidden");

    // Store current patient for export/print
    window.currentPatient = patient;
    window.currentRoomID = roomID;
};

// PDF Export Button Handler
document.getElementById("exportPdfBtn")?.addEventListener("click", async () => {
    if (!window.currentPatient) return;

    const patient = window.currentPatient;
    const { jsPDF } = window.jspdf;

    showToast("Generating PDF...", "info", 2000);

    try {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        let yPos = 20;

        // Header
        doc.setFontSize(20);
        doc.setFont("helvetica", "bold");
        doc.text("Laporan Pemeriksaan USG", pageWidth / 2, yPos, { align: "center" });
        yPos += 10;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Tele-USG Medical Report", pageWidth / 2, yPos, { align: "center" });
        yPos += 15;

        // Date
        doc.setFontSize(10);
        doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`, 14, yPos);
        yPos += 10;

        // Line separator
        doc.setLineWidth(0.5);
        doc.line(14, yPos, pageWidth - 14, yPos);
        yPos += 10;

        // Patient Info Section
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Data Pasien", 14, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const patientInfo = [
            ["Nama", patient.patient_name || "-"],
            ["Usia", patient.mother_age ? `${patient.mother_age} tahun` : "-"],
            ["Gravida/Para", `${patient.gravida || "-"}/${patient.para || "-"}`],
            ["HPHT (LMP)", patient.lmp || "-"],
            ["HPL (EDD)", patient.edd || "-"]
        ];

        patientInfo.forEach(([label, value]) => {
            doc.text(`${label}: ${value}`, 14, yPos);
            yPos += 6;
        });
        yPos += 5;

        // Biometry Section
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Biometri Janin", 14, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const biometry = [
            ["BPD", `${patient.bpd || "-"} mm`],
            ["HC", `${patient.hc || "-"} mm`],
            ["AC", `${patient.ac || "-"} mm`],
            ["FL", `${patient.fl || "-"} mm`],
            ["EFW", `${patient.efw || "-"} g`]
        ];

        // Display in 2 columns
        let col = 0;
        biometry.forEach(([label, value], i) => {
            const xPos = col === 0 ? 14 : 100;
            doc.text(`${label}: ${value}`, xPos, yPos);
            col++;
            if (col >= 2) {
                col = 0;
                yPos += 6;
            }
        });
        if (col !== 0) yPos += 6;
        yPos += 5;

        // Fetal Assessment
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Penilaian Janin", 14, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const fetal = [
            ["FHR", `${patient.fhr || "-"} bpm`],
            ["Presentasi", patient.presentation || "-"],
            ["Gerakan", patient.movement || "-"]
        ];

        fetal.forEach(([label, value]) => {
            doc.text(`${label}: ${value}`, 14, yPos);
            yPos += 6;
        });
        yPos += 5;

        // Diagnosis
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Diagnosis", 14, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const diagnosis = patient.diagnosis || "-";
        const diagLines = doc.splitTextToSize(diagnosis, pageWidth - 28);
        doc.text(diagLines, 14, yPos);
        yPos += diagLines.length * 5 + 5;

        // Recommendations
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Rekomendasi", 14, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const recs = patient.recommendations || "-";
        const recLines = doc.splitTextToSize(recs, pageWidth - 28);
        doc.text(recLines, 14, yPos);
        yPos += recLines.length * 5 + 10;

        // Add Screenshots Section
        if (window.currentRoomID) {
            // Get screenshots from Firebase (room-scoped)
            const screenshotsRef = ref(db, `rooms/${window.currentRoomID}/media/screenshots`);
            const screenshotsSnap = await get(screenshotsRef);
            const cloudScreenshots = screenshotsSnap.val() ? Object.values(screenshotsSnap.val()) : [];

            // Get local screenshots
            let localScreenshots = [];
            if (window.electronAPI) {
                try {
                    localScreenshots = await window.electronAPI.getLocalMediaList(window.currentRoomID, 'screenshots');
                } catch (e) { }
            }

            const allScreenshots = [
                ...localScreenshots.map(s => ({ url: `/savedata/${window.currentRoomID}/screenshots/${s.filename}`, source: 'local' })),
                ...cloudScreenshots.map(s => ({ url: s.url, source: 'cloud' }))
            ];

            if (allScreenshots.length > 0) {
                // Check if we need a new page for screenshots
                if (yPos > 200) {
                    doc.addPage();
                    yPos = 20;
                }

                doc.setFontSize(12);
                doc.setFont("helvetica", "bold");
                doc.text("Screenshot USG", 14, yPos);
                yPos += 10;

                // Fetch and add images (max 4 per PDF to avoid size issues)
                const maxImages = Math.min(allScreenshots.length, 4);
                for (let i = 0; i < maxImages; i++) {
                    try {
                        const imgUrl = allScreenshots[i].url;
                        const response = await fetch(imgUrl);
                        const blob = await response.blob();

                        // Convert to base64
                        const base64 = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        });

                        // Check if we need a new page
                        if (yPos > 230) {
                            doc.addPage();
                            yPos = 20;
                        }

                        // Add image (80mm wide, auto height)
                        const imgWidth = 80;
                        const imgHeight = 45; // 16:9 aspect ratio
                        doc.addImage(base64, 'JPEG', 14, yPos, imgWidth, imgHeight);
                        yPos += imgHeight + 5;

                    } catch (imgErr) {
                        console.warn("Could not add image to PDF:", imgErr);
                    }
                }

                if (allScreenshots.length > maxImages) {
                    doc.setFontSize(9);
                    doc.setFont("helvetica", "italic");
                    doc.text(`+ ${allScreenshots.length - maxImages} more screenshots (not shown)`, 14, yPos);
                }
            }
        }

        // Save PDF
        const filename = `USG_${patient.patient_name || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);

        showToast("PDF berhasil dibuat!", "success");
    } catch (err) {
        console.error("PDF generation error:", err);
        showToast("Gagal membuat PDF: " + err.message, "error");
    }
});

// Load patient media from Firebase (room-scoped) and local storage
async function loadPatientMedia(roomID) {
    const screenshotsGallery = document.getElementById("screenshotsGallery");
    const recordingsList = document.getElementById("recordingsList");

    // Load screenshots (cloud + local)
    try {
        const screenshots = [];

        // Load from cloud (room-scoped)
        const screenshotsRef = ref(db, `rooms/${roomID}/media/screenshots`);
        const screenshotsSnap = await get(screenshotsRef);
        console.log("📸 Raw Firebase snapshot exists:", screenshotsSnap.exists(), "val:", screenshotsSnap.val());
        if (screenshotsSnap.exists()) {
            screenshotsSnap.forEach(child => {
                console.log("📸 Processing child:", child.key, child.val());
                screenshots.push({
                    id: child.key,
                    source: 'cloud',
                    ...child.val()
                });
            });
        }
        console.log("📸 Total screenshots loaded:", screenshots.length, screenshots);

        // Load from local storage
        if (window.electronAPI) {
            const localScreenshots = await window.electronAPI.getLocalMediaList(roomID, 'screenshots');
            localScreenshots.forEach(file => {
                screenshots.push({
                    id: file.filename,
                    source: 'local',
                    url: `/savedata/${roomID}/screenshots/${file.filename}`,
                    timestamp: file.timestamp,
                    filename: file.filename
                });
            });
        }

        if (screenshots.length > 0) {
            // Sort by timestamp
            screenshots.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            screenshotsGallery.innerHTML = screenshots.map(s => `
        <div class="media-item" onclick="openLightbox('${s.url}')">
          <img src="${s.url}" alt="Screenshot" loading="lazy" />
          <span class="media-date">${formatDate(s.timestamp)}</span>
          <span class="media-source ${s.source}">${s.source === 'cloud' ? '<img src="/static/img/Cloud.png" class="source-icon" alt="">' : '<img src="/static/img/Folder.png" class="source-icon" alt="">'}</span>
        </div>
      `).join("");
        } else {
            screenshotsGallery.innerHTML = '<p class="no-media">Tidak ada screenshot</p>';
        }
    } catch (err) {
        console.error("Error loading screenshots:", err);
        screenshotsGallery.innerHTML = '<p class="no-media">Gagal memuat screenshot</p>';
    }

    // Load recordings (cloud + local)
    try {
        const recordings = [];

        // Load from cloud (room-scoped)
        const recordingsRef = ref(db, `rooms/${roomID}/media/recordings`);
        const recordingsSnap = await get(recordingsRef);
        if (recordingsSnap.exists()) {
            recordingsSnap.forEach(child => recordings.push({
                id: child.key,
                source: 'cloud',
                ...child.val()
            }));
        }

        // Load from local storage
        if (window.electronAPI) {
            const localRecordings = await window.electronAPI.getLocalMediaList(roomID, 'recordings');
            localRecordings.forEach(file => {
                recordings.push({
                    id: file.filename,
                    source: 'local',
                    url: `/savedata/${roomID}/recordings/${file.filename}`,
                    timestamp: file.timestamp,
                    filename: file.filename
                });
            });
        }

        if (recordings.length > 0) {
            // Sort by timestamp
            recordings.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            recordingsList.innerHTML = recordings.map(r => {
                // Generate thumbnail URL (local files have _thumb.jpg, cloud videos use Cloudinary thumbnail)
                let thumbnailUrl;
                if (r.source === 'local') {
                    // Local: thumbnail is saved alongside video as _thumb.jpg
                    const baseName = r.filename.replace(/\.(mp4|avi|webm)$/i, '');
                    thumbnailUrl = `/savedata/${roomID}/recordings/${baseName}_thumb.jpg`;
                } else {
                    // Cloud: use Cloudinary video thumbnail transformation
                    thumbnailUrl = r.url.replace('/video/upload/', '/video/upload/so_0,w_320,h_180,c_fill/').replace(/\.(mp4|avi|webm)$/i, '.jpg');
                }

                return `
        <div class="recording-item">
          <div class="recording-thumbnail" onclick="openVideoPlayer('${r.url}')">
            <img src="${thumbnailUrl}" alt="Video thumbnail" onerror="this.src='/static/img/video-placeholder.png'" />
            <div class="play-overlay">▶</div>
          </div>
          <div class="recording-info">
            <span class="media-date">${formatDate(r.timestamp)}</span>
            <span class="media-source ${r.source}">${r.source === 'cloud' ? '<img src="/static/img/Cloud.png" class="source-icon" alt="">' : '<img src="/static/img/Folder.png" class="source-icon" alt="">'}</span>
            <button class="download-btn" onclick="downloadFile('${r.url}', 'recording_${Date.now()}.mp4')">⬇ Download</button>
          </div>
        </div>
      `;
            }).join("");
        } else {
            recordingsList.innerHTML = '<p class="no-media">Tidak ada rekaman</p>';
        }
    } catch (err) {
        console.error("Error loading recordings:", err);
        recordingsList.innerHTML = '<p class="no-media">Gagal memuat rekaman</p>';
    }
}

// Lightbox
window.openLightbox = (url) => {
    lightboxImg.src = url;
    lightboxDownload.href = url;
    lightboxDownload.onclick = async (e) => {
        e.preventDefault();
        try {
            // Fetch the image and trigger download
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = `screenshot_${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (err) {
            console.error("Download failed:", err);
            // Fallback: open in new window
            window.open(url, '_blank');
        }
    };
    lightbox.classList.remove("hidden");
};

// Download File Helper
window.downloadFile = async (url, filename) => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error("Download failed:", err);
        // Fallback: open in new window
        window.open(url, '_blank');
    }
};

// Video Player Modal
window.openVideoPlayer = (url) => {
    // Create video player modal if not exists
    let videoModal = document.getElementById("videoPlayerModal");
    if (!videoModal) {
        videoModal = document.createElement("div");
        videoModal.id = "videoPlayerModal";
        videoModal.className = "video-player-modal hidden";
        videoModal.innerHTML = `
            <div class="video-player-content">
                <button class="video-player-close">&times;</button>
                <video id="videoPlayerElement" controls autoplay></video>
            </div>
        `;
        document.body.appendChild(videoModal);

        // Close on backdrop click
        videoModal.addEventListener("click", (e) => {
            if (e.target === videoModal) {
                closeVideoPlayer();
            }
        });

        // Close button
        videoModal.querySelector(".video-player-close").addEventListener("click", closeVideoPlayer);
    }

    const videoElement = document.getElementById("videoPlayerElement");
    videoElement.src = url;
    videoModal.classList.remove("hidden");
};

window.closeVideoPlayer = () => {
    const videoModal = document.getElementById("videoPlayerModal");
    const videoElement = document.getElementById("videoPlayerElement");
    if (videoModal) {
        videoModal.classList.add("hidden");
        if (videoElement) {
            videoElement.pause();
            videoElement.src = "";
        }
    }
};

// Add thumbnail and video player styles
const thumbnailStyles = document.createElement("style");
thumbnailStyles.textContent = `
    .recording-thumbnail {
        position: relative;
        width: 200px;
        height: 120px;
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        background: #1a1a2e;
    }
    .recording-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .recording-thumbnail .play-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 50px;
        height: 50px;
        background: rgba(0, 217, 255, 0.9);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        color: white;
        transition: all 0.2s ease;
    }
    .recording-thumbnail:hover .play-overlay {
        transform: translate(-50%, -50%) scale(1.1);
        background: rgba(0, 255, 136, 0.9);
    }
    .video-player-modal {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
    }
    .video-player-modal.hidden {
        display: none;
    }
    .video-player-content {
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
    }
    .video-player-content video {
        max-width: 90vw;
        max-height: 85vh;
        border-radius: 12px;
    }
    .video-player-close {
        position: absolute;
        top: -40px;
        right: 0;
        background: none;
        border: none;
        color: white;
        font-size: 36px;
        cursor: pointer;
        padding: 5px 15px;
    }
    .video-player-close:hover {
        color: #00d9ff;
    }
`;
document.head.appendChild(thumbnailStyles);

lightbox.querySelector(".lightbox-close").addEventListener("click", () => {
    lightbox.classList.add("hidden");
});

lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.classList.add("hidden");
});

// Close modal
closeModal.addEventListener("click", () => patientModal.classList.add("hidden"));
patientModal.addEventListener("click", (e) => {
    if (e.target === patientModal) patientModal.classList.add("hidden");
});

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${tab}`).classList.add("active");
    });
});

// Helpers
function formatDate(timestamp) {
    if (!timestamp) return "-";
    const date = new Date(timestamp);
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function truncate(str, len) {
    if (!str) return "";
    return str.length > len ? str.substring(0, len) + "..." : str;
}

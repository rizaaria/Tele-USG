// meeting.notes.js - Comprehensive medical notes with draggable window
export function initNotes(ctx) {
    const { db, roomID, elements, state, auth } = ctx;
    const { notesWindow, notesHeader, notesBtn, closeNotes } = elements;
    const { ref, set, onValue, off } = ctx.firebaseDb;

    // Get notes ref (room-scoped, shared between participants)
    function getNotesRef() {
        return ref(db, `rooms/${roomID}/notes`);
    }

    // All notes fields
    const notesFields = {
        timestamp: document.getElementById("notesDate"),
        patient_name: document.getElementById("patientNameInput"),
        mother_age: document.getElementById("motherAgeInput"),
        gravida: document.getElementById("gravidaInput"),
        para: document.getElementById("paraInput"),
        lmp: document.getElementById("lmpInput"),
        edd: document.getElementById("eddInput"),
        // Biometry
        crl: document.getElementById("crlInput"),
        bpd: document.getElementById("bpdInput"),
        hc: document.getElementById("hcInput"),
        ac: document.getElementById("acInput"),
        fl: document.getElementById("flInput"),
        efw: document.getElementById("efwInput"),
        // Assessment
        fhr: document.getElementById("fhrInput"),
        presentation: document.getElementById("presentationInput"),
        movement: document.getElementById("movementInput"),
        fetus_count: document.getElementById("fetusCountInput"),
        // Placenta
        placenta_loc: document.getElementById("placentaLocInput"),
        placenta_grade: document.getElementById("placentaGradeInput"),
        afi: document.getElementById("afiInput"),
        // Anatomy
        anat_brain: document.getElementById("anatBrain"),
        anat_spine: document.getElementById("anatSpine"),
        anat_heart: document.getElementById("anatHeart"),
        anat_stomach: document.getElementById("anatStomach"),
        anat_kidneys: document.getElementById("anatKidneys"),
        anat_bladder: document.getElementById("anatBladder"),
        anat_cord: document.getElementById("anatCord"),
        // Conclusion
        diagnosis: document.getElementById("diagnosisInput"),
        recommendations: document.getElementById("rekomInput"),
        additional_notes: document.getElementById("additionalInput")
    };

    // Set current date
    if (notesFields.timestamp) {
        notesFields.timestamp.value = new Date().toLocaleDateString("id-ID", {
            weekday: "long", year: "numeric", month: "long", day: "numeric"
        });
    }

    // Get chat panel reference
    const chatPanel = document.getElementById("chatPanel");
    let notesVisible = false;

    // Toggle notes/chat - when notes is shown, chat is hidden and vice versa
    if (notesBtn && notesWindow && chatPanel) {
        notesBtn.addEventListener("click", () => {
            notesVisible = !notesVisible;
            const btnImg = notesBtn.querySelector("img");
            if (notesVisible) {
                notesWindow.classList.remove("hidden");
                chatPanel.classList.add("hidden");
                // Change icon to Chat when notes is visible
                if (btnImg) btnImg.src = "/static/img/Chat.png";
            } else {
                notesWindow.classList.add("hidden");
                chatPanel.classList.remove("hidden");
                // Change icon back to Notes
                if (btnImg) btnImg.src = "/static/img/Notes.png";
            }
        });
    }

    // Load existing notes from Firebase (start listener when auth is ready)
    let unsubscribe = null;
    let isRemoteUpdate = false; // Flag to prevent save loop

    function startNotesListener() {
        const notesRef = getNotesRef();

        // Listen to room notes for real-time sync
        unsubscribe = onValue(notesRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            isRemoteUpdate = true;
            for (const key in notesFields) {
                if (notesFields[key] && data[key] !== undefined) {
                    // Only update if different to avoid cursor jumping
                    if (notesFields[key].value !== data[key]) {
                        notesFields[key].value = data[key];
                    }
                }
            }
            isRemoteUpdate = false;
        });
    }

    // Start listener with delay to allow auth to initialize
    setTimeout(startNotesListener, 100);

    // Auto-save with debounce
    let notesTimer = null;

    function saveNotes() {
        // Don't save if this is an update from the other device
        if (isRemoteUpdate) return;

        const notesRef = getNotesRef();

        const payload = {
            timestamp: new Date().toISOString(),
            roomID: roomID
        };
        for (const key in notesFields) {
            payload[key] = notesFields[key]?.value || "";
        }

        // Save to room-scoped location (shared between participants)
        set(notesRef, payload);
    }

    for (const key in notesFields) {
        if (!notesFields[key]) continue;
        notesFields[key].addEventListener("input", () => {
            clearTimeout(notesTimer);
            notesTimer = setTimeout(saveNotes, 500);
        });
        notesFields[key].addEventListener("change", () => {
            clearTimeout(notesTimer);
            notesTimer = setTimeout(saveNotes, 300);
        });
    }

    return { saveNotes };
}

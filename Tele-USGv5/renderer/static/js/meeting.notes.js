// meeting.notes.js
// Notes module (Firebase RTDB)

export function initNotes(ctx) {
  const { db, roomID, elements, state } = ctx;
  const { notesWindow, notesBtn, closeNotes, notesFields } = elements;
  const { ref, set, onValue } = ctx.firebaseDb;

  const notesRef = ref(db, `notes/${roomID}`);
  state._notesRef = notesRef;

  if (notesBtn && notesWindow) notesBtn.addEventListener("click", () => notesWindow.classList.remove("hidden"));
  if (closeNotes && notesWindow) closeNotes.addEventListener("click", () => notesWindow.classList.add("hidden"));

  onValue(notesRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    for (const key in notesFields) {
      if (notesFields[key]) notesFields[key].value = data[key] || "";
    }
  });

  let notesTimer = null;

  function saveNotes() {
    const now = new Date().toISOString();
    const payload = { timestamp: now };
    for (const key in notesFields) payload[key] = notesFields[key]?.value || "";
    set(notesRef, payload);
  }

  for (const key in notesFields) {
    if (!notesFields[key]) continue;
    notesFields[key].addEventListener("input", () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(saveNotes, 400);
    });
  }

  return { saveNotes };
}

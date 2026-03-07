// meeting.chat.js
// Chat module (Firebase RTDB)

export function initChat(ctx) {
  const { db, roomID, elements, state } = ctx;
  const { chatMessages, chatText, chatSend, chatHeader } = elements;

  const { ref, push, set, onChildAdded, query, orderByChild, off } = ctx.firebaseDb;

  const chatRef = ref(db, `chats/${roomID}`);
  state._chatRef = chatRef;

  function appendChatMessage(name, message, isSelf) {
    if (!chatMessages) return;

    const wrapper = document.createElement("div");
    wrapper.classList.add("chat-message");
    wrapper.classList.add(isSelf ? "chat-self" : "chat-other");

    if (!isSelf) {
      const nameDiv = document.createElement("div");
      nameDiv.classList.add("chat-name");
      nameDiv.textContent = name || "User";
      wrapper.appendChild(nameDiv);
    }

    const msgDiv = document.createElement("div");
    msgDiv.textContent = message;
    wrapper.appendChild(msgDiv);

    chatMessages.appendChild(wrapper);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendChatMessage() {
    const text = (chatText?.value || "").trim();
    if (!text) return;

    const msgRef = push(chatRef);
    await set(msgRef, {
      nickname: state.nickname || "User",
      message: text,
      timestamp: Date.now()
    });

    if (chatText) chatText.value = "";
    autoResizeChat();
  }

  function autoResizeChat() {
    if (!chatText) return;
    const maxHeight = 120;
    chatText.style.height = "auto";
    const newHeight = Math.min(chatText.scrollHeight, maxHeight);
    chatText.style.height = newHeight + "px";
    chatText.style.overflowY = (chatText.scrollHeight > maxHeight) ? "auto" : "hidden";
  }

  function attachChatListener() {
    if (state._chatListenerAttached) return;
    const q = query(chatRef, orderByChild("timestamp"));
    onChildAdded(q, (snapshot) => {
      const data = snapshot.val();
      if (!data || !data.message) return;
      const name = data.nickname || "User";
      const isSelf = (name === (state.nickname || "User"));
      appendChatMessage(name, data.message, isSelf);
    });
    state._chatListenerAttached = true;
  }

  // Events
  if (chatSend) chatSend.addEventListener("click", () => sendChatMessage().catch(console.error));
  if (chatText) {
    chatText.addEventListener("input", autoResizeChat);
    chatText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage().catch(console.error);
      }
    });
  }

  if (chatHeader && chatMessages) {
    chatHeader.addEventListener("click", () => {
      const body = chatMessages.parentElement?.querySelector(".chat-body");
      const icon = chatHeader.querySelector(".expand-icon");
      if (!body) return;
      const collapsed = body.style.display === "none";
      body.style.display = collapsed ? "block" : "none";
      if (icon) icon.textContent = collapsed ? "▲" : "▼";
    });
  }

  return {
    attachChatListener,
    cleanup() { try { off(chatRef); } catch {} },
  };
}

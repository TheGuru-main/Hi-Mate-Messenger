import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { onMessage } from "./socket.js";

let activeConversationUid = null;

function renderKliqueEntry(k, myUid) {
  const otherUid = k.from_uid === myUid ? k.to_uid : k.from_uid;
  const div = document.createElement("div");
  div.className = "list-item";
  div.innerHTML = `
    <div class="avatar">${otherUid.slice(-2)}</div>
    <div>
      <div class="name">${otherUid}</div>
      <div class="sub">Klique · tap to chat</div>
    </div>
  `;
  div.onclick = () => openChat(otherUid, otherUid);
  return div;
}

export async function loadKliqueList() {
  const list = document.getElementById("klique-list");
  list.innerHTML = `<div class="section-title">Loading…</div>`;
  try {
    const me = getCachedUser();
    const kliques = await api.kliqueList();
    list.innerHTML = "";
    if (!kliques.length) {
      list.innerHTML = `<div class="section-title">No Kliques yet — search for people to connect with.</div>`;
      return;
    }
    kliques.forEach((k) => list.appendChild(renderKliqueEntry(k, me?.uid)));
  } catch (e) {
    list.innerHTML = `<div class="error-text">${e.message}</div>`;
  }
}

function renderBubble(msg, isMine) {
  const row = document.createElement("div");
  row.className = `bubble-row ${isMine ? "mine" : "theirs"}`;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${isMine ? "mine" : "theirs"}`;
  bubble.textContent = msg.content || "";
  row.appendChild(bubble);
  return row;
}

export async function openChat(uid, displayName) {
  activeConversationUid = uid;
  document.getElementById("chat-room-title").textContent = displayName || uid;
  showPage("chat-room");

  const container = document.getElementById("chat-messages");
  container.innerHTML = `<div class="section-title">Loading…</div>`;
  try {
    const me = getCachedUser();
    const messages = await api.getMessages(uid);
    container.innerHTML = "";
    messages.reverse().forEach((m) => {
      container.appendChild(renderBubble(m, m.sender_uid === me?.uid));
    });
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    container.innerHTML = `<div class="error-text">${e.message}</div>`;
  }
}

export function initChat() {
  document.getElementById("btn-back-from-chat").onclick = () => {
    activeConversationUid = null;
    showPage("home");
  };

  document.getElementById("btn-send-message").onclick = sendCurrentMessage;
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendCurrentMessage();
  });

  // Live incoming messages
  onMessage((data) => {
    if (data.type !== "message") return;
    const me = getCachedUser();
    const isRelevant =
      data.sender_uid === activeConversationUid || data.receiver_uid === activeConversationUid;
    if (!isRelevant) return;

    const container = document.getElementById("chat-messages");
    container.appendChild(renderBubble(data, data.sender_uid === me?.uid));
    container.scrollTop = container.scrollHeight;
  });
}

async function sendCurrentMessage() {
  const input = document.getElementById("chat-input");
  const content = input.value.trim();
  if (!content || !activeConversationUid) return;
  input.value = "";

  const me = getCachedUser();
  const container = document.getElementById("chat-messages");
  container.appendChild(renderBubble({ content }, true)); // optimistic render
  container.scrollTop = container.scrollHeight;

  try {
    await api.sendMessage({ receiver_uid: activeConversationUid, type: "text", content });
  } catch (e) {
    alert(e.message);
  }
}

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
      <div><div class="name">${otherUid}</div><div class="sub">Klique · tap to chat</div></div>
    `;
    div.addEventListener("click", () => openChat(otherUid, otherUid));
    return div;
}

export async function loadKliqueList() {
    const list = document.getElementById("klique-list");
    if (!list) return;
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const me = getCachedUser();
        const kliques = await api.kliqueList();
        list.innerHTML = "";
        if (!kliques.length) {
            list.innerHTML = '<div class="section-title">No Kliques yet — search for people to connect with.</div>';
            return;
        }
        kliques.forEach(k => list.appendChild(renderKliqueEntry(k, me ? me.uid : null)));
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function renderBubble(content, isMine) {
    const row = document.createElement("div");
    row.className = "bubble-row " + (isMine ? "mine" : "theirs");
    const bubble = document.createElement("div");
    bubble.className = "bubble " + (isMine ? "mine" : "theirs");
    bubble.textContent = content || "";
    row.appendChild(bubble);
    return row;
}

export async function openChat(uid, displayName) {
    activeConversationUid = uid;
    const titleEl = document.getElementById("chat-room-title");
    if (titleEl) titleEl.textContent = displayName || uid;
    showPage("chat-room");

    const container = document.getElementById("chat-messages");
    container.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const me = getCachedUser();
        const messages = await api.getMessages(uid);
        container.innerHTML = "";
        messages.reverse().forEach(m => {
            container.appendChild(renderBubble(m.content, m.sender_uid === (me ? me.uid : null)));
        });
        container.scrollTop = container.scrollHeight;
    } catch (e) {
        container.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

async function sendCurrentMessage() {
    const input = document.getElementById("chat-input");
    const content = input.value.trim();
    if (!content || !activeConversationUid) return;
    input.value = "";

    const container = document.getElementById("chat-messages");
    container.appendChild(renderBubble(content, true));
    container.scrollTop = container.scrollHeight;

    try {
        await api.sendMessage({ receiver_uid: activeConversationUid, type: "text", content });
    } catch (e) {
        alert(e.message);
    }
}

export function initChat() {
    const backBtn = document.getElementById("btn-back-from-chat");
    if (backBtn) backBtn.addEventListener("click", () => { activeConversationUid = null; showPage("home"); });

    const sendBtn = document.getElementById("btn-send-message");
    if (sendBtn) sendBtn.addEventListener("click", sendCurrentMessage);

    const input = document.getElementById("chat-input");
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendCurrentMessage(); });

    onMessage((data) => {
        if (data.type !== "message") return;
        const me = getCachedUser();
        const isRelevant = data.sender_uid === activeConversationUid || data.receiver_uid === activeConversationUid;
        if (!isRelevant) return;
        const container = document.getElementById("chat-messages");
        if (!container) return;
        container.appendChild(renderBubble(data.content, data.sender_uid === (me ? me.uid : null)));
        container.scrollTop = container.scrollHeight;
    });
}

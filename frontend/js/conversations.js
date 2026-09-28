import { api } from "./api.js";
import { openChat } from "./chat.js";
import { onMessage } from "./socket.js";
import { timeAgo } from "./media-utils.js";

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

export async function loadConversations() {
    const list = document.getElementById("conversation-list");
    if (!list) return;
    try {
        const convos = await api.getConversations();
        list.innerHTML = convos.length ? "" : '<div class="section-title">No messages yet.</div>';
        convos.forEach(c => {
            const div = document.createElement("div");
            div.className = "list-item";
            div.innerHTML = `
              <div class="avatar">${escapeHtml((c.username || "?").slice(0, 2).toUpperCase())}</div>
              <div style="flex:1; min-width:0;">
                <div class="name">${escapeHtml(c.username)}</div>
                <div class="sub convo-preview">${c.sent_by_me ? "You: " : ""}${escapeHtml(c.last_message || "")}</div>
              </div>
              <div class="sub">${timeAgo(c.last_message_at)}</div>
            `;
            div.addEventListener("click", () => openChat(c.uid, c.username));
            list.appendChild(div);
        });
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

export function initConversations() {
    let timer;
    onMessage((data) => {
        if (data.type !== "message") return;
        clearTimeout(timer);
        timer = setTimeout(loadConversations, 400);
    });
}

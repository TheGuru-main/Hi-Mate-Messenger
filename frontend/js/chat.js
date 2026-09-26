import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { onMessage } from "./socket.js";

let activeConversationUid = null;
let activeConversationType = "user"; // "user" | "group"

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

async function loadIntoRoom(conversationId) {
    const container = document.getElementById("chat-messages");
    container.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const me = getCachedUser();
        const messages = await api.getMessages(conversationId);
        container.innerHTML = "";
        messages.reverse().forEach(m => {
            container.appendChild(renderBubble(m.content, m.sender_uid === (me ? me.uid : null)));
        });
        container.scrollTop = container.scrollHeight;
    } catch (e) {
        container.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

export async function openChat(uid, displayName) {
    activeConversationUid = uid;
    activeConversationType = "user";
    const titleEl = document.getElementById("chat-room-title");
    if (titleEl) titleEl.textContent = displayName || uid;
    showPage("chat-room");
    await loadIntoRoom(uid);
}

export async function openGroupChat(group) {
    activeConversationUid = group.group_id;
    activeConversationType = "group";
    const titleEl = document.getElementById("chat-room-title");
    if (titleEl) titleEl.textContent = group.name;
    showPage("chat-room");
    await loadIntoRoom(group.group_id);
}

async function sendCurrentMessage() {
    const input = document.getElementById("chat-input");
    const content = input.value.trim();
    if (!content || !activeConversationUid) return;
    input.value = "";

    const container = document.getElementById("chat-messages");
    container.appendChild(renderBubble(content, true));
    container.scrollTop = container.scrollHeight;

    const payload = activeConversationType === "group"
        ? { group_id: activeConversationUid, type: "text", content }
        : { receiver_uid: activeConversationUid, type: "text", content };

    try {
        await api.sendMessage(payload);
    } catch (e) {
        alert(e.message);
    }
}

function closeKliqueModal() {
    const existing = document.querySelector(".klique-modal-overlay");
    if (existing) existing.remove();
}

async function openCreateGroupModal() {
    closeKliqueModal();
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";

    let kliques = [];
    try { kliques = await api.kliqueList(); } catch (e) { /* ignore */ }
    const me = getCachedUser();
    const options = kliques.map(k => {
        const otherUid = k.from_uid === (me ? me.uid : null) ? k.to_uid : k.from_uid;
        return `<label class="status-recipient-option"><input type="checkbox" value="${otherUid}"> ${otherUid}</label>`;
    }).join("");

    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Create Group</div>
          <button class="icon-btn klique-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <input class="input-box" id="group-name-input" placeholder="Group name">
        <div class="section-title">Add members</div>
        <div class="status-recipients">${options || '<div class="section-title">No Kliques yet</div>'}</div>
        <button class="primary-btn" id="group-create-btn">Create</button>
        <div class="error-text" id="group-create-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".klique-modal-close").addEventListener("click", closeKliqueModal);

    overlay.querySelector("#group-create-btn").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#group-create-error");
        const name = overlay.querySelector("#group-name-input").value.trim();
        const member_uids = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
        if (!name) { errEl.textContent = "Give the group a name."; return; }
        try {
            const group = await api.createGroup({ name, member_uids });
            closeKliqueModal();
            openGroupChat(group);
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

function renderContactMatches(body, matches) {
    if (!matches.length) {
        body.innerHTML = '<div class="section-title">None of these contacts are on Hi-Mate yet.</div>';
        return;
    }
    body.innerHTML = matches.map(m => `
      <div class="list-item" data-uid="${m.uid}">
        <div class="avatar">${(m.username || "?").slice(0, 2).toUpperCase()}</div>
        <div><div class="name">${m.username}</div><div class="sub">On Hi-Mate · tap to message</div></div>
      </div>
    `).join("");
    body.querySelectorAll(".list-item").forEach(item => {
        item.addEventListener("click", () => {
            closeKliqueModal();
            openChat(item.dataset.uid, item.querySelector(".name").textContent);
        });
    });
}

async function openContactsModal() {
    closeKliqueModal();
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";
    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Add from Contacts</div>
          <button class="icon-btn klique-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div id="contacts-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".klique-modal-close").addEventListener("click", closeKliqueModal);
    const body = overlay.querySelector("#contacts-body");

    if (navigator.contacts && navigator.contacts.select) {
        body.innerHTML = `<button class="primary-btn" id="pick-contacts-btn">Pick Contacts</button>`;
        overlay.querySelector("#pick-contacts-btn").addEventListener("click", async () => {
            try {
                const contacts = await navigator.contacts.select(["tel"], { multiple: true });
                const phoneNumbers = contacts.flatMap(c => c.tel || []);
                if (!phoneNumbers.length) { body.innerHTML = '<div class="section-title">No phone numbers found.</div>'; return; }
                body.innerHTML = '<div class="section-title">Matching…</div>';
                const res = await api.matchContacts(phoneNumbers);
                renderContactMatches(body, res.matches);
            } catch (e) {
                body.innerHTML = `<div class="error-text">${e.message}</div>`;
            }
        });
    } else {
        body.innerHTML = `
          <div class="section-title">Contact picker isn't supported on this browser — paste numbers instead, one per line.</div>
          <textarea class="input-box" id="manual-numbers" placeholder="+2348012345678"></textarea>
          <button class="primary-btn" id="manual-match-btn">Match</button>
        `;
        overlay.querySelector("#manual-match-btn").addEventListener("click", async () => {
            const raw = overlay.querySelector("#manual-numbers").value;
            const phoneNumbers = raw.split("\n").map(s => s.trim()).filter(Boolean);
            if (!phoneNumbers.length) return;
            body.innerHTML = '<div class="section-title">Matching…</div>';
            try {
                const res = await api.matchContacts(phoneNumbers);
                renderContactMatches(body, res.matches);
            } catch (e) {
                body.innerHTML = `<div class="error-text">${e.message}</div>`;
            }
        });
    }
}

export function initChat() {
    const backBtn = document.getElementById("btn-back-from-chat");
    if (backBtn) backBtn.addEventListener("click", () => { activeConversationUid = null; showPage("home"); });

    const sendBtn = document.getElementById("btn-send-message");
    if (sendBtn) sendBtn.addEventListener("click", sendCurrentMessage);

    const input = document.getElementById("chat-input");
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendCurrentMessage(); });

    const createGroupBtn = document.getElementById("btn-create-group");
    if (createGroupBtn) createGroupBtn.addEventListener("click", openCreateGroupModal);

    const addContactsBtn = document.getElementById("btn-add-contacts");
    if (addContactsBtn) addContactsBtn.addEventListener("click", openContactsModal);

    onMessage((data) => {
        if (data.type !== "message") return;
        const me = getCachedUser();
        const isRelevant = data.sender_uid === activeConversationUid || data.receiver_uid === activeConversationUid || data.group_id === activeConversationUid;
        if (!isRelevant) return;
        const container = document.getElementById("chat-messages");
        if (!container) return;
        container.appendChild(renderBubble(data.content, data.sender_uid === (me ? me.uid : null)));
        container.scrollTop = container.scrollHeight;
    });
}

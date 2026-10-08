import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { onMessage } from "./socket.js";

let activeConversationUid = null;
let activeConversationType = "user";
let activeGroup = null;

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

function renderBubble(content, isMine, messageId = null, pendingKey = null) {
    const row = document.createElement("div");
    row.className = "bubble-row " + (isMine ? "mine" : "theirs");

    if (messageId) {
        row.dataset.messageId = String(messageId);
    }

    if (pendingKey) {
        row.dataset.pendingKey = String(pendingKey);
    }

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

function updateGroupSettingsVisibility() {
    const btn = document.getElementById("btn-group-settings");
    if (!btn) return;
    btn.classList.toggle("hidden", activeConversationType !== "group");
}

export async function openChat(uid, displayName) {
    activeConversationUid = uid;
    activeConversationType = "user";
    activeGroup = null;
    const titleEl = document.getElementById("chat-room-title");
    if (titleEl) titleEl.textContent = displayName || uid;
    showPage("chat-room");
    updateGroupSettingsVisibility();
    await loadIntoRoom(uid);
}

export async function openGroupChat(group) {
    activeConversationUid = group.group_id;
    activeConversationType = "group";
    activeGroup = group;
    const titleEl = document.getElementById("chat-room-title");
    if (titleEl) titleEl.textContent = group.name;
    showPage("chat-room");
    updateGroupSettingsVisibility();
    await loadIntoRoom(group.group_id);
}

async function sendCurrentMessage() {
    const input = document.getElementById("chat-input");
    if (!input) return;

    const content = input.value.trim();
    if (!content || !activeConversationUid) return;

    input.value = "";

    const container = document.getElementById("chat-messages");
    if (!container) return;

    /*
     * The backend echoes the saved message over WebSocket to BOTH
     * receiver and sender. Keep one optimistic bubble and let the
     * WebSocket event reconcile it by message id/content.
     */
    const pendingKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const bubbleRow = renderBubble(
        content,
        true,
        null,
        pendingKey
    );

    container.appendChild(bubbleRow);
    container.scrollTop = container.scrollHeight;

    const payload = activeConversationType === "group"
        ? {
            group_id: activeConversationUid,
            type: "text",
            content
        }
        : {
            receiver_uid: activeConversationUid,
            type: "text",
            content
        };

    try {
        const saved = await api.sendMessage(payload);

        /*
         * If WebSocket has not arrived yet, attach the server id
         * to the optimistic bubble. If WebSocket already reconciled
         * it, this lookup simply finds nothing and does no harm.
         */
        const pending = container.querySelector(
            `[data-pending-key="${CSS.escape(pendingKey)}"]`
        );

        if (pending && saved?.id) {
            pending.dataset.messageId = String(saved.id);
            delete pending.dataset.pendingKey;
        }
    } catch (e) {
        bubbleRow.remove();
        alert(e.message);
    }
}


function closeKliqueModal() {
    const existing = document.querySelector(".klique-modal-overlay");
    if (existing) existing.remove();
}

async function getKliqueAndFollowerOptions() {
    const me = getCachedUser();
    let kliques = [];
    let followers = [];
    try { kliques = await api.kliqueList(); } catch (e) {}
    try { followers = await api.getFollowers(); } catch (e) {}

    const kliqueUids = kliques.map(k => k.from_uid === (me ? me.uid : null) ? k.to_uid : k.from_uid);
    const combined = new Map();
    kliqueUids.forEach(uid => combined.set(uid, { uid, label: `${uid} · Klique` }));
    followers.forEach(f => { if (!combined.has(f.uid)) combined.set(f.uid, { uid: f.uid, label: `${f.username} · Follower` }); });

    return Array.from(combined.values());
}

async function openCreateGroupModal() {
    closeKliqueModal();
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";

    const people = await getKliqueAndFollowerOptions();
    const options = people.map(p => `<label class="status-recipient-option"><input type="checkbox" value="${p.uid}"> ${p.label}</label>`).join("");

    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Create Group</div>
          <button class="icon-btn klique-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <input class="input-box" id="group-name-input" placeholder="Group name">
        <input class="input-box" id="group-uid-input" placeholder="Pick an 8-digit Group UID" inputmode="numeric" maxlength="8">
        <textarea class="input-box" id="group-description-input" placeholder="Introduction / narration — what's this group about?"></textarea>
        <input class="input-box" id="group-purpose-input" placeholder="Purpose (e.g. Business, Tech, Casual, Punditry)">
        <select class="input-box" id="group-visibility-input">
          <option value="private">Private — invite only / admin add</option>
          <option value="public">Public — anyone can search and join</option>
        </select>
        <div class="section-title">Add members (Kliques & Followers)</div>
        <div class="status-recipients">${options || '<div class="section-title">No Kliques or Followers yet</div>'}</div>
        <button class="primary-btn" id="group-create-btn">Create</button>
        <div class="error-text" id="group-create-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".klique-modal-close").addEventListener("click", closeKliqueModal);

    overlay.querySelector("#group-create-btn").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#group-create-error");
        const name = overlay.querySelector("#group-name-input").value.trim();
        const group_uid = overlay.querySelector("#group-uid-input").value.trim();
        const description = overlay.querySelector("#group-description-input").value.trim();
        const purpose = overlay.querySelector("#group-purpose-input").value.trim();
        const member_uids = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
        if (!name) { errEl.textContent = "Give the group a name."; return; }
        if (!/^\d{8}$/.test(group_uid)) { errEl.textContent = "Group UID must be exactly 8 digits."; return; }
        try {
            const group = await api.createGroup({ name, description, purpose, member_uids, group_uid });
            closeKliqueModal();
            openGroupChat(group);
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

export async function openMyGroupsModal() {
    closeKliqueModal();

    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";

    overlay.innerHTML = `
      <div class="status-composer my-groups-panel">
        <div class="status-viewer-header">
          <div class="status-viewer-name">My Groups</div>
          <button class="icon-btn klique-modal-close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <button
          type="button"
          class="secondary-btn my-groups-create-btn"
        >
          <i class="fa-solid fa-users"></i>
          Create Group
        </button>

        <div id="my-groups-list" class="my-groups-list"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay
        .querySelector(".klique-modal-close")
        .addEventListener("click", closeKliqueModal);

    overlay
        .querySelector(".my-groups-create-btn")
        .addEventListener("click", () => {
            closeKliqueModal();
            openCreateGroupModal();
        });

    const list = overlay.querySelector("#my-groups-list");

    list.innerHTML =
        '<div class="section-title">Loading…</div>';

    try {
        const groups = await api.getMyGroups();

        if (!groups.length) {
            list.innerHTML = `
                <div class="section-title my-groups-empty">
                    You haven't created or joined any groups yet.
                </div>
            `;
            return;
        }

        list.innerHTML = "";

        groups.forEach((g) => {
            const item = document.createElement("div");

            item.className = "my-group-room";

            const name =
                String(g.name || "Unnamed Group").trim();

            const initials =
                name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part.charAt(0))
                    .join("")
                    .toUpperCase() || "G";

            const memberCount =
                Array.isArray(g.member_uids)
                    ? g.member_uids.length
                    : 0;

            item.innerHTML = `
                <div class="my-group-avatar">
                    ${initials}
                </div>

                <div class="my-group-info">
                    <div class="my-group-name">
                        ${name}
                    </div>

                    <div class="my-group-meta">
                        ${memberCount} members · ${g.visibility || "private"}
                    </div>
                </div>

                <i class="fa-solid fa-chevron-right my-group-arrow"></i>
            `;

            item.addEventListener("click", () => {
                closeKliqueModal();
                openGroupChat(g);
            });

            list.appendChild(item);
        });

    } catch (e) {
        list.innerHTML =
            `<div class="error-text">${e.message}</div>`;
    }
}

async function openAddMemberModal() {
    if (!activeGroup) return;
    closeKliqueModal();
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";

    const people = await getKliqueAndFollowerOptions();
    const options = people.map(p => `<label class="status-recipient-option"><input type="checkbox" value="${p.uid}"> ${p.label}</label>`).join("");

    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Add Members</div>
          <button class="icon-btn klique-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="status-recipients">${options || '<div class="section-title">No Kliques or Followers yet</div>'}</div>
        <button class="primary-btn" id="add-member-btn">Add Selected</button>
        <div class="error-text" id="add-member-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".klique-modal-close").addEventListener("click", closeKliqueModal);

    overlay.querySelector("#add-member-btn").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#add-member-error");
        const uids = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
        if (!uids.length) { errEl.textContent = "Select at least one person."; return; }
        try {
            const updated = await api.addGroupMembers(activeGroup.group_id, uids);
            activeGroup = updated;
            closeKliqueModal();
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

function groupInviteLink(groupId) {
    return `${window.location.origin}${window.location.pathname}?join_group=${groupId}`;
}

async function openShareGroupLinkModal() {
    if (!activeGroup) return;
    closeKliqueModal();
    const link = groupInviteLink(activeGroup.group_id);
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";

    const people = await getKliqueAndFollowerOptions();
    const options = people.map(p => `<label class="status-recipient-option"><input type="checkbox" value="${p.uid}"> ${p.label}</label>`).join("");

    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Invite to ${activeGroup.name}</div>
          <button class="icon-btn klique-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <button class="secondary-btn" id="copy-link-btn"><i class="fa-solid fa-link"></i> Copy Group Link</button>
        <button class="secondary-btn" id="share-external-btn"><i class="fa-solid fa-up-right-from-square"></i> Share Externally</button>
        <button class="secondary-btn" id="share-feed-btn"><i class="fa-solid fa-arrow-rotate-right"></i> Post Invite to Feed</button>
        <div class="section-title">Or send directly to Kliques / Followers</div>
        <div class="status-recipients">${options || '<div class="section-title">No Kliques or Followers yet</div>'}</div>
        <button class="primary-btn" id="send-invite-btn">Send Invite</button>
        <div class="error-text" id="invite-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".klique-modal-close").addEventListener("click", closeKliqueModal);

    overlay.querySelector("#copy-link-btn").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(link); alert("Link copied"); } catch (e) {}
    });
    overlay.querySelector("#share-external-btn").addEventListener("click", async () => {
        if (navigator.share) { try { await navigator.share({ text: `Join ${activeGroup.name} on Hi-Mate: ${link}` }); } catch (e) {} }
        else { try { await navigator.clipboard.writeText(link); alert("Link copied"); } catch (e) {} }
    });
    overlay.querySelector("#share-feed-btn").addEventListener("click", async () => {
        try {
            await api.createPost({ category: "Personal", content: `Join my group "${activeGroup.name}" on Hi-Mate: ${link}`, media_refs: [] });
            closeKliqueModal();
        } catch (e) { alert(e.message); }
    });
    overlay.querySelector("#send-invite-btn").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#invite-error");
        const uids = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
        if (!uids.length) { errEl.textContent = "Select at least one person."; return; }
        try {
            await Promise.all(uids.map(uid => Promise.all([
                api.sendMessage({ receiver_uid: uid, type: "text", content: `Join my group "${activeGroup.name}" on Hi-Mate: ${link}` }),
                api.sendNotification({ recipient_uid: uid, type: "group_invite", message: `You're invited to join "${activeGroup.name}"` }),
            ])));
            closeKliqueModal();
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

async function openGroupSettingsModal() {
    if (!activeGroup) return;
    closeKliqueModal();
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";

    let group = activeGroup;
    try { group = await api.getGroup(activeGroup.group_id); } catch (e) {}

    const me = getCachedUser();
    const canEdit = me && group.created_by_uid === me.uid;

    let pendingHtml = "";
    if (canEdit && group.pending_uids && group.pending_uids.length) {
        try {
            const pending = await api.getPendingMembers(group.group_id);
            pendingHtml = `
              <div class="section-title">Pending Approval (${pending.length})</div>
              ${pending.map(p => `
                <div class="list-item" data-pending-uid="${p.uid}">
                  <div class="avatar">${p.username.slice(0, 2).toUpperCase()}</div>
                  <div><div class="name">${p.username}</div></div>
                  <button class="secondary-btn approve-btn" data-uid="${p.uid}">Approve</button>
                </div>
              `).join("")}
            `;
        } catch (e) {}
    }

    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Group Settings</div>
          <button class="icon-btn klique-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <label class="form-section label">Name</label>
        <input class="input-box" id="group-settings-name" value="${group.name || ""}" ${canEdit ? "" : "disabled"}>
        <label class="form-section label">Introduction / Narration</label>
        <textarea class="input-box" id="group-settings-description" ${canEdit ? "" : "disabled"}>${group.description || ""}</textarea>
        <label class="form-section label">Purpose</label>
        <input class="input-box" id="group-settings-purpose" value="${group.purpose || ""}" ${canEdit ? "" : "disabled"}>
        <label class="form-section label">Visibility</label>
        <select class="input-box" id="group-settings-visibility" ${canEdit ? "" : "disabled"}>
          <option value="private" ${group.visibility === "private" ? "selected" : ""}>Private — invite only / admin add</option>
          <option value="public" ${group.visibility === "public" ? "selected" : ""}>Public — searchable, anyone can join</option>
        </select>
        <div class="section-title">${group.member_uids.length} members</div>
        ${canEdit ? '<button class="primary-btn" id="group-settings-save">Save Changes</button>' : ""}
        <div class="error-text" id="group-settings-error"></div>

        <div class="settings-action-row">
          <button class="secondary-btn" id="settings-add-member"><i class="fa-solid fa-user-plus"></i> Add Member</button>
          <button class="secondary-btn" id="settings-invite-link"><i class="fa-solid fa-link"></i> Invite / Share Link</button>
        </div>
        <div class="settings-action-row">
          <button class="secondary-btn" id="settings-video-call"><i class="fa-solid fa-video"></i> Video Call</button>
          <button class="secondary-btn" id="settings-voice-call"><i class="fa-solid fa-phone"></i> Voice Call</button>
        </div>

        ${pendingHtml}
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".klique-modal-close").addEventListener("click", closeKliqueModal);

    if (canEdit) {
        overlay.querySelector("#group-settings-save").addEventListener("click", async () => {
            const errEl = overlay.querySelector("#group-settings-error");
            try {
                const updated = await api.updateGroup(group.group_id, {
                    name: overlay.querySelector("#group-settings-name").value.trim(),
                    description: overlay.querySelector("#group-settings-description").value.trim(),
                    purpose: overlay.querySelector("#group-settings-purpose").value.trim(),
                    visibility: overlay.querySelector("#group-settings-visibility").value,
                });
                activeGroup = updated;
                document.getElementById("chat-room-title").textContent = updated.name;
                closeKliqueModal();
            } catch (e) {
                errEl.textContent = e.message;
            }
        });

        overlay.querySelectorAll(".approve-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                try {
                    await api.approveMember(group.group_id, btn.dataset.uid);
                    btn.closest(".list-item").remove();
                } catch (e) { alert(e.message); }
            });
        });
    }

    overlay.querySelector("#settings-add-member").addEventListener("click", openAddMemberModal);
    overlay.querySelector("#settings-invite-link").addEventListener("click", openShareGroupLinkModal);

    // Video/Voice Call: routes through the existing group call entry point already
    // wired in the chat-room top bar — this is NOT a new call system, just a
    // shortcut into what's already there. True multi-party scale still depends
    // on the underlying signaling-only WebRTC setup.
    overlay.querySelector("#settings-video-call").addEventListener("click", () => {
        closeKliqueModal();
        const callBtn = document.getElementById("btn-start-group-call");
        if (callBtn) callBtn.click();
    });
    overlay.querySelector("#settings-voice-call").addEventListener("click", () => {
        closeKliqueModal();
        alert("Voice-only calling needs to be confirmed against the existing call system before this button does something distinct from Video Call.");
    });
}

function normalizePhoneForMatch(raw, myDialCode) {
    let cleaned = raw.replace(/[^\d+]/g, "");
    if (cleaned.startsWith("+")) return cleaned;
    cleaned = cleaned.replace(/^0+/, "");
    return (myDialCode || "") + cleaned;
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

    const me = getCachedUser();
    const myCountry = me ? window.getCountryByName?.(me.country) : null;
    const myDialCode = myCountry ? myCountry.dial_code : "";

    if (navigator.contacts && navigator.contacts.select) {
        body.innerHTML = `<button class="primary-btn" id="pick-contacts-btn">Pick Contacts</button>`;
        overlay.querySelector("#pick-contacts-btn").addEventListener("click", async () => {
            try {
                const contacts = await navigator.contacts.select(["tel"], { multiple: true });
                const rawNumbers = contacts.flatMap(c => c.tel || []);
                if (!rawNumbers.length) { body.innerHTML = '<div class="section-title">No phone numbers found.</div>'; return; }
                const phoneNumbers = rawNumbers.map(n => normalizePhoneForMatch(n, myDialCode));
                body.innerHTML = '<div class="section-title">Matching…</div>';
                const res = await api.matchContacts(phoneNumbers);
                renderContactMatches(body, res.matches);
            } catch (e) {
                body.innerHTML = `<div class="error-text">${e.message}</div>`;
            }
        });
    } else {
        body.innerHTML = `
          <div class="section-title">Contact picker isn't supported on this browser — paste numbers instead, one per line. Local format (e.g. 0803...) works too.</div>
          <textarea class="input-box" id="manual-numbers" placeholder="0803xxxxxxx or +2348xxxxxxx"></textarea>
          <button class="primary-btn" id="manual-match-btn">Match</button>
        `;
        overlay.querySelector("#manual-match-btn").addEventListener("click", async () => {
            const raw = overlay.querySelector("#manual-numbers").value;
            const rawNumbers = raw.split("\n").map(s => s.trim()).filter(Boolean);
            if (!rawNumbers.length) return;
            const phoneNumbers = rawNumbers.map(n => normalizePhoneForMatch(n, myDialCode));
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

export function getActiveConversation() {
    return { uid: activeConversationUid, type: activeConversationType, group: activeGroup };
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

    const myGroupsBtn = document.getElementById("btn-my-groups");
    if (myGroupsBtn) myGroupsBtn.addEventListener("click", openMyGroupsModal);

    const addContactsBtn = document.getElementById("btn-add-contacts");
    if (addContactsBtn) addContactsBtn.addEventListener("click", openContactsModal);

    const groupSettingsBtn = document.getElementById("btn-group-settings");
    if (groupSettingsBtn) groupSettingsBtn.addEventListener("click", openGroupSettingsModal);

    onMessage((data) => {
        if (data.type !== "message") return;

        const me = getCachedUser();
        const myUid = me ? me.uid : null;

        const isRelevant =
            data.sender_uid === activeConversationUid ||
            data.receiver_uid === activeConversationUid ||
            data.group_id === activeConversationUid;

        if (!isRelevant) return;

        const container = document.getElementById("chat-messages");
        if (!container) return;

        const messageId = data.id ? String(data.id) : null;

        /*
         * First: exact server-id deduplication.
         */
        if (
            messageId &&
            container.querySelector(
                `[data-message-id="${CSS.escape(messageId)}"]`
            )
        ) {
            return;
        }

        /*
         * Second: reconcile the sender's optimistic bubble.
         * The backend deliberately echoes to the sender, so don't
         * append another copy of our own message.
         */
        if (data.sender_uid === myUid) {
            const pendingRows = Array.from(
                container.querySelectorAll(".bubble-row[data-pending-key]")
            );

            const pending = pendingRows.find(row => {
                const bubble = row.querySelector(".bubble");
                return bubble && bubble.textContent === (data.content || "");
            });

            if (pending) {
                if (messageId) {
                    pending.dataset.messageId = messageId;
                }
                delete pending.dataset.pendingKey;
                return;
            }
        }

        container.appendChild(
            renderBubble(
                data.content,
                data.sender_uid === myUid,
                messageId
            )
        );

        container.scrollTop = container.scrollHeight;
    });
}

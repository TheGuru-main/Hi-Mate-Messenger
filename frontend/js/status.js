import { api, getCachedUser } from "./api.js";

let statusGroups = [];

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

function closeModal() {
    const existing = document.querySelector(".status-modal-overlay");
    if (existing) existing.remove();
}

function renderStatusStrip() {
    const strip = document.getElementById("status-strip");
    if (!strip) return;
    strip.innerHTML = "";

    const addBtn = document.createElement("div");
    addBtn.className = "status-avatar-wrap";
    addBtn.innerHTML = `
      <div class="status-avatar add-status"><i class="fa-solid fa-plus"></i></div>
      <div class="status-avatar-label">Your Status</div>
    `;
    addBtn.addEventListener("click", openStatusComposer);
    strip.appendChild(addBtn);

    statusGroups.forEach(group => {
        const wrap = document.createElement("div");
        wrap.className = "status-avatar-wrap";
        const initials = (group.author_username || "?").slice(0, 2).toUpperCase();
        wrap.innerHTML = `
          <div class="status-avatar has-status">${initials}</div>
          <div class="status-avatar-label">${escapeHtml(group.is_me ? "You" : group.author_username)}</div>
        `;
        wrap.addEventListener("click", () => openStatusViewer(group));
        strip.appendChild(wrap);
    });
}

export async function loadStatusFeed() {
    try {
        statusGroups = await api.getStatusFeed();
        renderStatusStrip();
    } catch (e) {
        console.error(e);
    }
}

function openStatusViewer(group) {
    closeModal();
    let index = 0;
    const overlay = document.createElement("div");
    overlay.className = "status-modal-overlay";

    function render() {
        const s = group.statuses[index];
        overlay.innerHTML = `
          <div class="status-viewer">
            <div class="status-viewer-header">
              <div class="status-viewer-name">${escapeHtml(group.author_username)}</div>
              <button class="icon-btn status-viewer-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="status-viewer-progress">
              ${group.statuses.map((_, i) => `<span class="status-progress-bar ${i < index ? "seen" : ""} ${i === index ? "active" : ""}"></span>`).join("")}
            </div>
            <div class="status-viewer-body">
              ${s.media_ref ? `<img src="${s.media_ref}" class="status-media">` : ""}
              ${s.content ? `<div class="status-text">${escapeHtml(s.content)}</div>` : ""}
            </div>
            <div class="status-viewer-nav">
              <div class="status-nav-zone prev"></div>
              <div class="status-nav-zone next"></div>
            </div>
          </div>
        `;
        overlay.querySelector(".status-viewer-close").addEventListener("click", closeModal);
        overlay.querySelector(".prev").addEventListener("click", () => {
            if (index > 0) { index--; render(); } else { closeModal(); }
        });
        overlay.querySelector(".next").addEventListener("click", () => {
            if (index < group.statuses.length - 1) { index++; render(); } else { closeModal(); }
        });
    }

    render();
    document.body.appendChild(overlay);
}

async function openStatusComposer() {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "status-modal-overlay";

    let kliques = [];
    try { kliques = await api.kliqueList(); } catch (e) { /* ignore */ }
    const me = getCachedUser();
    const kliqueOptions = kliques.map(k => {
        const otherUid = k.from_uid === (me ? me.uid : null) ? k.to_uid : k.from_uid;
        return `<label class="status-recipient-option"><input type="checkbox" value="${otherUid}"> ${escapeHtml(otherUid)}</label>`;
    }).join("");

    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Post a Status</div>
          <button class="icon-btn status-viewer-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <textarea class="input-box" id="status-content" placeholder="What's happening?"></textarea>
        <label class="form-section label">Duration</label>
        <select class="input-box" id="status-duration">
          <option value="">Select duration…</option>
          <option value="1h">1 hour</option>
          <option value="24h">24 hours</option>
          <option value="3d">3 days</option>
          <option value="1w">1 week</option>
        </select>
        <label class="form-section label">Share to</label>
        <select class="input-box" id="status-visibility">
          <option value="global">All Kliques</option>
          <option value="targeted">Choose specific Kliques</option>
        </select>
        <div id="status-recipients" class="status-recipients hidden">${kliqueOptions || '<div class="section-title">No Kliques yet</div>'}</div>
        <button class="primary-btn" id="status-post-btn">Post Status</button>
        <div class="error-text" id="status-error"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector(".status-viewer-close").addEventListener("click", closeModal);

    const visSelect = overlay.querySelector("#status-visibility");
    const recipientsBox = overlay.querySelector("#status-recipients");
    visSelect.addEventListener("change", () => {
        recipientsBox.classList.toggle("hidden", visSelect.value !== "targeted");
    });

    overlay.querySelector("#status-post-btn").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#status-error");
        errEl.textContent = "";
        const content = overlay.querySelector("#status-content").value.trim();
        const duration = overlay.querySelector("#status-duration").value;
        const visibility = visSelect.value;

        if (!content) { errEl.textContent = "Write something first."; return; }
        if (!duration) { errEl.textContent = "Please choose a duration."; return; }

        let recipient_uids = [];
        if (visibility === "targeted") {
            recipient_uids = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
            if (!recipient_uids.length) { errEl.textContent = "Pick at least one Klique to share with."; return; }
        }

        try {
            await api.createStatus({ content, duration, visibility, recipient_uids });
            closeModal();
            loadStatusFeed();
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

export function initStatus() {
    // nothing to wire on boot beyond loadStatusFeed — kept for symmetry with other init* functions
}

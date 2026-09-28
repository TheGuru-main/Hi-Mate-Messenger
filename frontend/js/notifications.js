import { api } from "./api.js";

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

async function refreshBadge() {
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    try {
        const res = await api.getUnreadNotificationCount();
        if (res.count > 0) {
            badge.textContent = res.count > 9 ? "9+" : String(res.count);
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    } catch (e) { /* ignore */ }
}

export async function openNotificationsPanel() {
    const existing = document.querySelector(".notif-modal-overlay");
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement("div");
    overlay.className = "notif-modal-overlay feed-modal-overlay";
    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Notifications</div>
          <button class="icon-btn notif-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <button class="secondary-btn" id="notif-mark-all">Mark all as read</button>
        <div id="notif-list" class="scroll-list"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".notif-close").addEventListener("click", () => overlay.remove());

    const list = overlay.querySelector("#notif-list");
    try {
        const notifications = await api.getNotifications();
        list.innerHTML = notifications.length
            ? notifications.map(n => `
                <div class="list-item notif-item ${n.is_read ? "" : "unread"}" data-id="${n.id}">
                  <div class="avatar">🔔</div>
                  <div><div class="name">${escapeHtml(n.message)}</div><div class="sub">${new Date(n.created_at).toLocaleString()}</div></div>
                </div>
              `).join("")
            : '<div class="section-title">No notifications yet.</div>';

        notifications.forEach(n => {
            if (n.type !== "klique_request") return;
            const row = list.querySelector(`.notif-item[data-id="${n.id}"]`);
            if (!row) return;
            const btn = document.createElement("button");
            btn.className = "secondary-btn notif-accept-btn";
            btn.textContent = "Accept";
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                try {
                    const pending = await api.kliquePending();
                    const match = pending.find(p => p.from_uid === n.actor_uid);
                    if (!match) { alert("This request is no longer pending."); return; }
                    await api.kliqueAccept(match.id);
                    btn.textContent = "Accepted ✓";
                    btn.disabled = true;
                } catch (e) { alert(e.message); }
            });
            row.appendChild(btn);
        });
        list.querySelectorAll(".notif-item").forEach(item => {
            item.addEventListener("click", async () => {
                try { await api.markNotificationRead(item.dataset.id); item.classList.remove("unread"); refreshBadge(); } catch (e) {}
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }

    overlay.querySelector("#notif-mark-all").addEventListener("click", async () => {
        try {
            await api.markAllNotificationsRead();
            overlay.querySelectorAll(".notif-item").forEach(i => i.classList.remove("unread"));
            refreshBadge();
        } catch (e) {}
    });
}

export function initNotifications() {
    const btn = document.getElementById("btn-open-notifications");
    if (btn) btn.addEventListener("click", openNotificationsPanel);
    refreshBadge();
    setInterval(refreshBadge, 30000);
}

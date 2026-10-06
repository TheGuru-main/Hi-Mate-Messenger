// ==========================================
// HI-MATE MESSENGER
// settings.js
// ==========================================

import { api, clearToken, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { openProfile } from "./profile.js";
import { openNotificationsPanel } from "./notifications.js";

function showStaticPanel(title, bodyHtml) {
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";
    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">${title}</div>
          <button class="icon-btn static-panel-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        ${bodyHtml}
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".static-panel-close").addEventListener("click", () => overlay.remove());
}

const MENU_ACTIONS = {
    notifications: () => openNotificationsPanel(),
    settings: () => { const me = getCachedUser(); if (me) openProfile(me.uid); },
    language: () => { const me = getCachedUser(); if (me) openProfile(me.uid); },
    about: () => showStaticPanel("About Hi-Mate", `
        <div class="section-title">Hi-Mate Messenger</div>
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">
          Connect with friends, families, and business partners — locally and globally.
        </p>
        <p style="font-size:12px; color:var(--text-faint); margin-top:10px;">Powered by The Guru Innovations 🌀</p>
    `),
    help_support: () => showStaticPanel("Help & Support", `
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">
          Having trouble? Reach out through your account contact or check back soon —
          a full support flow is on the way.
        </p>
    `),
};

function renderMenuItem(item) {
    const div = document.createElement("div");
    div.className = "settings-item";
    const statusLabel = item.status === "coming_soon" ? "Coming Soon" : item.status === "external" ? "External" : "";
    div.innerHTML = `
      <span>${item.label}</span>
      ${statusLabel ? `<span class="status-badge ${item.status}">${statusLabel}</span>` : ""}
    `;
    if (item.key === "logout") {
        div.addEventListener("click", doLogout);
    } else if (item.status === "coming_soon") {
        div.addEventListener("click", () => alert(item.label + " is coming soon."));
    } else if (MENU_ACTIONS[item.key]) {
        div.addEventListener("click", MENU_ACTIONS[item.key]);
    } else {
        div.addEventListener("click", () => alert(item.label + " — not built yet."));
    }
    return div;
}

async function loadSettingsMenu() {
    const list = document.getElementById("settings-menu");
    if (!list) return;
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const items = await api.getSettingsMenu();
        list.innerHTML = "";

        items.forEach(item => {
            list.appendChild(renderMenuItem(item));
        });

        list.appendChild(renderBackgroundModeControl());
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function renderBackgroundModeControl() {
    const div = document.createElement("div");
    div.className = "settings-item background-mode-setting";

    const currentMode =
        localStorage.getItem("himate_background_mode") || "classic";

    div.innerHTML = `
        <div style="width:100%;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <span>Background Mode</span>
                <i class="fa-solid fa-palette"></i>
            </div>

            <div style="display:flex;gap:8px;margin-top:10px;">
                <button
                    type="button"
                    class="chip background-mode-btn ${currentMode === "classic" ? "active" : ""}"
                    data-background-mode="classic"
                    style="flex:1;"
                >
                    Classic
                </button>

                <button
                    type="button"
                    class="chip background-mode-btn ${currentMode === "network" ? "active" : ""}"
                    data-background-mode="network"
                    style="flex:1;"
                >
                    Network
                </button>
            </div>
        </div>
    `;

    div.querySelectorAll(".background-mode-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const mode = button.dataset.backgroundMode;

            if (typeof window.setHiMateBackgroundMode === "function") {
                window.setHiMateBackgroundMode(mode);
            } else {
                document.body.classList.remove(
                    "background-classic",
                    "background-network"
                );

                document.body.classList.add(
                    mode === "network"
                        ? "background-network"
                        : "background-classic"
                );

                localStorage.setItem(
                    "himate_background_mode",
                    mode
                );
            }

            div.querySelectorAll(".background-mode-btn")
                .forEach((btn) => {
                    btn.classList.toggle(
                        "active",
                        btn.dataset.backgroundMode === mode
                    );
                });
        });
    });

    return div;
}

function doLogout() {
    clearToken();
    localStorage.removeItem("himate_user");
    showPage("auth-phone");
}

export function initSettings() {
    const openBtn = document.getElementById("btn-open-settings");
    if (openBtn) openBtn.addEventListener("click", () => { showPage("settings"); loadSettingsMenu(); });

    const backBtn = document.getElementById("btn-back-from-settings");
    if (backBtn) backBtn.addEventListener("click", () => showPage("home"));

    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
}

// ==========================================
// HI-MATE MESSENGER
// settings.js
// ==========================================

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
    } else {
        div.addEventListener("click", () => alert(item.label + " — screen not built yet."));
    }
    return div;
}

async function loadSettingsMenu() {
    const list = document.getElementById("settings-menu");
    if (!list) return;
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const items = await HiMateAPI.getSettingsMenu();
        list.innerHTML = "";
        items.forEach(item => list.appendChild(renderMenuItem(item)));
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function doLogout() {
    clearToken();
    localStorage.removeItem("himate_user");
    goToPage("auth");
}

export function initSettings() {
    const openBtn = document.getElementById("btn-open-settings");
    if (openBtn) openBtn.addEventListener("click", () => { goToPage("settings"); loadSettingsMenu(); });

    const backBtn = document.getElementById("btn-back-from-settings");
    if (backBtn) backBtn.addEventListener("click", () => goToPage("home"));

    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
}

window.addEventListener("load", initSettings);

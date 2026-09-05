import { api, clearToken } from "./api.js";
import { showPage } from "./router.js";

function renderMenuItem(item) {
  const div = document.createElement("div");
  div.className = "settings-item";
  const statusLabel = item.status === "coming_soon" ? "Coming Soon" : item.status === "external" ? "External" : "";
  div.innerHTML = `
    <span>${item.label}</span>
    ${statusLabel ? `<span class="status-badge ${item.status}">${statusLabel}</span>` : ""}
  `;
  if (item.key === "logout") {
    div.onclick = doLogout;
  } else if (item.status === "coming_soon") {
    div.onclick = () => alert(`${item.label} is coming soon.`);
  } else {
    div.onclick = () => alert(`${item.label} — screen not built yet.`);
  }
  return div;
}

export async function loadSettingsMenu() {
  const list = document.getElementById("settings-menu");
  list.innerHTML = `<div class="section-title">Loading…</div>`;
  try {
    const items = await api.getSettingsMenu();
    list.innerHTML = "";
    items.forEach((item) => list.appendChild(renderMenuItem(item)));
  } catch (e) {
    list.innerHTML = `<div class="error-text">${e.message}</div>`;
  }
}

function doLogout() {
  clearToken();
  localStorage.removeItem("himate_user");
  showPage("auth-phone");
}

export function initSettings() {
  document.getElementById("btn-open-settings").onclick = () => {
    showPage("settings");
    loadSettingsMenu();
  };
  document.getElementById("btn-back-from-settings").onclick = () => showPage("home");
  document.getElementById("btn-logout").onclick = doLogout;
}

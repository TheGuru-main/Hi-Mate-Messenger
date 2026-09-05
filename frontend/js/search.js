import { api } from "./api.js";
import { openChat } from "./chat.js";

let currentMode = "username";

function renderUserResult(user) {
  const div = document.createElement("div");
  div.className = "list-item";
  div.innerHTML = `
    <div class="avatar">${(user.username || "?").slice(0, 2).toUpperCase()}</div>
    <div>
      <div class="name">${user.username}</div>
      <div class="sub">${user.uid}</div>
    </div>
  `;
  div.onclick = () => openChat(user.uid, user.username);
  return div;
}

function renderContentResult(item) {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <div class="meta">${item.category || ""} · score ${item.total?.toFixed?.(1) ?? ""}</div>
    <div class="content">${item.content || ""}</div>
  `;
  return div;
}

function renderKliqueSuggestion(item) {
  const div = document.createElement("div");
  div.className = "list-item";
  div.innerHTML = `
    <div class="avatar">${item.uid.slice(-2)}</div>
    <div>
      <div class="name">${item.uid}</div>
      <div class="sub">match score ${item.score?.toFixed?.(1) ?? ""}</div>
    </div>
  `;
  div.onclick = async () => {
    try {
      await api.kliqueRequest(item.uid);
      div.querySelector(".sub").textContent = "Klique request sent";
    } catch (e) {
      alert(e.message);
    }
  };
  return div;
}

async function runSearch() {
  const q = document.getElementById("search-input").value.trim();
  const results = document.getElementById("search-results");
  results.innerHTML = "";

  try {
    if (currentMode === "klique") {
      const suggestions = await api.kliqueSuggestions();
      suggestions.forEach((s) => results.appendChild(renderKliqueSuggestion(s)));
      return;
    }
    if (!q) return;
    if (currentMode === "content") {
      const items = await api.smartSearch(q);
      items.forEach((i) => results.appendChild(renderContentResult(i)));
    } else {
      const users = await api.search(q, currentMode);
      (Array.isArray(users) ? users : []).forEach((u) => u && results.appendChild(renderUserResult(u)));
    }
  } catch (e) {
    results.innerHTML = `<div class="error-text">${e.message}</div>`;
  }
}

export function initSearch() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentMode = chip.dataset.mode;
      runSearch();
    };
  });
  document.querySelector('.chip[data-mode="username"]').classList.add("active");

  let debounce;
  document.getElementById("search-input").addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 400);
  });
}

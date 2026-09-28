import { api } from "./api.js";
import { openProfile } from "./profile.js";
import { openChat } from "./chat.js";
import { buildConnectRow } from "./connect-utils.js";
import { talentLabel, businessLabel } from "./categories.js";

let currentSearchMode = "username";

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

function renderUserResult(user) {
    const div = document.createElement("div");
    div.className = "card search-result-card";

    const initials = (user.username || "?").slice(0, 2).toUpperCase();
    const locationParts = [user.locality, user.region, user.country].filter(Boolean).join(", ");
    const talentBadge = user.talent_category ? `<span class="talent-badge">${escapeHtml(talentLabel(user.talent_category))}</span>` : "";
    const businessBadge = user.business_category ? `<span class="talent-badge">${escapeHtml(businessLabel(user.business_category))}</span>` : "";

    div.innerHTML = `
      <div class="post-header">
        <div class="avatar profile-tap" data-uid="${user.uid}">${initials}</div>
        <div class="post-header-text">
          <div class="post-author-name profile-tap" data-uid="${user.uid}">${escapeHtml(user.username)} ${talentBadge} ${businessBadge}</div>
          <div class="post-meta">${locationParts ? escapeHtml(locationParts) : "Location not set"}</div>
        </div>
      </div>
    `;
    div.querySelectorAll(".profile-tap").forEach(el => {
        el.addEventListener("click", () => openProfile(el.dataset.uid));
    });

    if (!user.is_me) {
        const canDm = user.klique_status === "accepted" || user.is_contact;
        div.appendChild(buildConnectRow({
            uid: user.uid,
            kliqueStatus: user.klique_status,
            isFollowing: user.is_following,
            messageLabel: canDm ? "Message" : "Message Request",
            onMessage: () => openChat(user.uid, user.username),
        }));
    }
    return div;
}

function renderContentResult(item) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="meta">${item.category || ""} · score ${item.total ? item.total.toFixed(1) : ""}</div>
      <div class="content">${escapeHtml(item.content)}</div>
    `;
    return div;
}

function renderKliqueSuggestion(item) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <div class="avatar">${item.uid.slice(-2)}</div>
      <div><div class="name">${item.uid}</div><div class="sub">match score ${item.score ? item.score.toFixed(1) : ""}</div></div>
    `;
    div.addEventListener("click", async () => {
        try {
            await api.kliqueRequest(item.uid);
            div.querySelector(".sub").textContent = "Klique request sent";
        } catch (e) {
            alert(e.message);
        }
    });
    return div;
}

async function runSearch() {
    const q = document.getElementById("search-input").value.trim();
    const results = document.getElementById("search-results");
    results.innerHTML = "";

    try {
        if (currentSearchMode === "klique") {
            const suggestions = await api.kliqueSuggestions();
            suggestions.forEach(s => results.appendChild(renderKliqueSuggestion(s)));
            return;
        }
        if (!q) return;
        if (currentSearchMode === "content") {
            const items = await api.smartSearch(q);
            items.forEach(i => results.appendChild(renderContentResult(i)));
        } else {
            const users = await api.search(q, currentSearchMode);
            (Array.isArray(users) ? users : []).forEach(u => u && results.appendChild(renderUserResult(u)));
        }
    } catch (e) {
        results.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

export function initSearch() {
    const chips = document.querySelectorAll(".chip");
    if (!chips.length) return;
    chips.forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentSearchMode = chip.dataset.mode;
            runSearch();
        });
    });
    const defaultChip = document.querySelector('.chip[data-mode="username"]');
    if (defaultChip) defaultChip.classList.add("active");

    let debounce;
    const input = document.getElementById("search-input");
    if (input) {
        input.addEventListener("input", () => {
            clearTimeout(debounce);
            debounce = setTimeout(runSearch, 400);
        });
    }
}

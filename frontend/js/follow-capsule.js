// Follow capsules: every followable team / player name gets a tinted capsule with a (+) button.
import { api } from "./api.js";
import { playerFavId, toggleFavoritePlayer, listFavoritePlayers } from "./player-sheet.js";

const PLUS = '<button type="button" class="fc-plus" aria-label="Follow">+</button>';
const SEL = ".md-player, .md-team, .pc-link, .match-club-name[data-tid], .match-team-tap[data-tid]";

let clubSet = new Set();
let clubsAt = 0;
let clubsPromise = null;

function loadClubs(force) {
  if (!force && Date.now() - clubsAt < 30000) return Promise.resolve();
  if (clubsPromise) return clubsPromise;
  clubsPromise = api.getMyClubs()
    .then((list) => {
      clubSet = new Set((list || []).map((c) => `${c.sport || "football"}:${c.team_key}`));
    })
    .catch(() => {})
    .then(() => {
      clubsAt = Date.now();
      clubsPromise = null;
    });
  return clubsPromise;
}

function playerInfo(cap) {
  const host = cap.closest("[data-fixture]");
  return {
    playerId: cap.dataset.pid || null,
    name: cap.dataset.name,
    side: cap.dataset.side || "club",
    fixtureId: host ? host.dataset.fixture : null,
  };
}

function isOn(cap) {
  if (cap.dataset.kind === "team") {
    return clubSet.has(`${cap.dataset.sport || "football"}:${cap.dataset.key}`);
  }
  try {
    const id = playerFavId(playerInfo(cap));
    return listFavoritePlayers().some((f) => f.id === id);
  } catch (e) {
    return false;
  }
}

function setOn(cap, on) {
  cap.classList.toggle("fc-on", on);
  const b = cap.querySelector(".fc-plus");
  if (!b) return;
  const t = on ? "✓" : "+";
  if (b.textContent !== t) b.textContent = t;
  b.setAttribute("aria-label", on ? "Following" : "Follow");
}

function syncCapsule(cap) {
  setOn(cap, isOn(cap));
}

export function syncAll() {
  document.querySelectorAll(".fc[data-kind]").forEach(syncCapsule);
}

function enhanceEl(el) {
  if (el.closest(".fc") || !el.parentNode) return;
  const isPlayer = el.classList.contains("md-player");
  if (!isPlayer && !el.dataset.tid) return;

  const cap = document.createElement("span");
  cap.className = `fc ${isPlayer ? "fc-player" : "fc-team"}`;
  cap.dataset.kind = isPlayer ? "player" : "team";
  cap.dataset.name = el.dataset.name || el.textContent.trim();

  if (isPlayer) {
    cap.dataset.pid = el.dataset.pid || "";
    cap.dataset.side = el.dataset.side || "club";
  } else {
    cap.dataset.key = el.dataset.tid;
    cap.dataset.logo = el.dataset.logo || "";
    cap.dataset.sport = el.dataset.sport || "football";
  }

  el.parentNode.insertBefore(cap, el);
  cap.appendChild(el);
  cap.insertAdjacentHTML("beforeend", PLUS);
  syncCapsule(cap);
}

function scan(root) {
  root.querySelectorAll(SEL).forEach(enhanceEl);
}

async function toggleTeam(cap) {
  const key = cap.dataset.key;
  const sport = cap.dataset.sport || "football";
  const id = `${sport}:${key}`;
  const was = clubSet.has(id);

  cap.classList.add("fc-busy");

  try {
    if (was) {
      await api.unfollowClub(key, sport);
      clubSet.delete(id);
    } else {
      await api.followClub(
        key,
        { name: cap.dataset.name || "Club", logo: cap.dataset.logo || null },
        sport
      );
      clubSet.add(id);
    }
    document.dispatchEvent(new CustomEvent("hm:clubs-changed", { detail: { src: "fc" } }));
  } catch (e) {
    const b = cap.querySelector(".fc-plus");
    if (b) {
      b.textContent = "!";
      setTimeout(() => syncCapsule(cap), 1500);
    }
  }

  cap.classList.remove("fc-busy");
}

// Capture phase: the (+) must not also open the room, the sheet or the profile behind it.
document.addEventListener("click", (e) => {
  const btn = e.target.closest ? e.target.closest(".fc-plus") : null;
  if (!btn) return;

  e.stopPropagation();
  e.preventDefault();

  const cap = btn.closest(".fc");

  if (!cap || cap.classList.contains("fc-busy")) return;

  if (cap.dataset.kind === "player") {
    setOn(cap, toggleFavoritePlayer(playerInfo(cap)));
    return;
  }

  toggleTeam(cap);
}, true);

document.addEventListener("hm:clubs-changed", (e) => {
  if (e.detail && e.detail.src === "fc") {
    syncAll();
    return;
  }
  loadClubs(true).then(syncAll);
});

document.addEventListener("hm:players-changed", syncAll);

function start() {
  scan(document.body);
  loadClubs().then(syncAll);

  let queued = false;

  new MutationObserver((records) => {
    if (queued) return;

    const added = records.some((r) =>
      Array.from(r.addedNodes).some((n) => n.nodeType === 1)
    );

    if (!added) return;

    queued = true;

    requestAnimationFrame(() => {
      queued = false;
      scan(document.body);
      loadClubs().then(syncAll);
    });
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);

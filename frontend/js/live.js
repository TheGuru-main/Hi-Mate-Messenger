// Live Video: hub (Live Video tab), Go live / Schedule form, and the live room (presence + chat + gifts).
// The video itself joins in a later step; the room is fully usable without it.
import { api, getToken } from "./api.js";
import { openSheet } from "./sheet.js";
import { showTab } from "./router.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const fmt = (n) => Number(n || 0).toLocaleString();
const SKEL = '<div class="md-skel"></div><div class="md-skel"></div>';
const GIFT_ICON = { clap: "👏", rose: "🌹", mic: "🎤", drum: "🥁", crown: "👑", trophy: "🏆", spotlight: "🌟" };
const initials = (n) => String(n || "?").slice(0, 2).toUpperCase();
const uuid = () => (window.crypto && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

let hub = null;
const listEl = () => document.getElementById("live-video-list");

/* --------------------------------- hub --------------------------------- */

function hideComingSoon() {
  const tab = document.getElementById("tab-live-video");
  if (!tab) return;
  Array.from(tab.children).forEach((el) => {
    if (el.id === "live-video-list") return;
    if (/coming soon/i.test(el.textContent || "")) el.classList.add("hidden");
  });
}

function cardHtml(s) {
  const live = s.status === "live";
  const badge = live
    ? `<span class="lv-badge lv-live">LIVE · ${fmt(s.viewers)} watching</span>`
    : `<span class="lv-badge">${esc(when(s.scheduled_at))}</span>`;
  const kind = s.kind === "podcast" ? "🎙 Podcast" : "📡 Live";
  return `<div class="lv-card" data-id="${esc(s.id)}">
    <div class="lv-card-top">${badge}<span>${kind}</span></div>
    <div class="lv-title">${esc(s.title)}</div>
    <div class="lv-sub">${esc(s.host_username || "Host")}${s.is_host ? " (you)" : ""}${s.visibility === "kliques" ? " · Kliques only" : ""}</div>
  </div>`;
}

function gateNote(g) {
  return g && !g.ok
    ? `<div class="ps-note lv-gate">Hosting unlocks at ${fmt(g.need_followers)} followers and ${fmt(g.need_kliques)} mutual Kliques. You have ${fmt(g.followers)} and ${fmt(g.kliques)}.</div>`
    : "";
}

function hubHtml(h) {
  const section = (title, rows, empty) =>
    `<div class="lv-section">${esc(title)}</div>${rows.length ? rows.map(cardHtml).join("") : `<div class="lv-empty">${esc(empty)}</div>`}`;
  return `
    <div class="lv-actions"><button type="button" class="primary-btn lv-go">📡 Go live or schedule</button></div>
    ${gateNote(h.gate)}
    ${section("Live now", h.live, "Nobody is live right now.")}
    ${section("Upcoming", h.upcoming, "Nothing scheduled yet.")}
    <div id="lv-dev" class="lv-actions"></div>`;
}

function checkDev() {
  api.devStatus().then(() => {
    const box = document.getElementById("lv-dev");
    if (box) box.innerHTML = '<button type="button" class="pf-btn lv-dev-grant">Dev: add 100,000 test B</button>';
  }).catch(() => { /* not a developer account */ });
}

async function loadHub() {
  const el = listEl();
  if (!el || !getToken()) return;
  hideComingSoon();
  if (!hub) el.innerHTML = SKEL;
  try {
    hub = await api.getLiveHub();
    el.innerHTML = hubHtml(hub);
    checkDev();
  } catch (e) {
    if (!hub) el.innerHTML = `<div class="match-data-error">${esc(e.message)}</div>`;
  }
}

/* ------------------------------ go live form ------------------------------ */

function openGoLive() {
  const sheet = openSheet({ title: "Go live or schedule", html: `
    <div class="pf-form">
      ${gateNote(hub && hub.gate)}
      <label>Type</label>
      <select class="input-box" data-f="kind"><option value="live">Live video</option><option value="podcast">Podcast (audio)</option></select>
      <label>Title</label>
      <input class="input-box" data-f="title" maxlength="100" placeholder="e.g. Friday night freestyle">
      <label>About <span class="optional-tag">optional</span></label>
      <textarea class="input-box" data-f="desc" maxlength="500" rows="3"></textarea>
      <label>Who can join</label>
      <select class="input-box" data-f="vis"><option value="public">Everyone</option><option value="kliques">My Kliques only</option></select>
      <label>When</label>
      <select class="input-box" data-f="when"><option value="now">Go live now</option><option value="later">Schedule for later</option></select>
      <input class="input-box" data-f="at" type="datetime-local" style="display:none">
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Go live now</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);

  q("when").addEventListener("change", () => {
    const later = q("when").value === "later";
    q("at").style.display = later ? "" : "none";
    q("save").textContent = later ? "Schedule" : "Go live now";
  });

  q("save").addEventListener("click", async () => {
    const err = q("err");
    err.textContent = "";
    const title = q("title").value.trim();
    if (title.length < 3) { err.textContent = "Add a title (at least 3 characters)."; return; }
    const later = q("when").value === "later";
    let at = null;
    if (later) {
      const d = new Date(q("at").value);
      if (!q("at").value || isNaN(d)) { err.textContent = "Pick a date and time."; return; }
      at = d.toISOString();
    }
    const btn = q("save");
    btn.disabled = true;
    try {
      const s = await api.createLive({
        kind: q("kind").value, title,
        description: q("desc").value.trim() || null,
        visibility: q("vis").value,
        go_now: !later, scheduled_at: at,
      });
      sheet.close();
      await loadHub();
      if (!later) openRoom(s.id);
    } catch (e) {
      err.textContent = e.message || "Couldn't create it.";
      btn.disabled = false;
    }
  });
}

/* -------------------------------- live room -------------------------------- */

function roomHtml(d) {
  const gifts = d.is_host ? "" : (d.gifts || []).map((g) =>
    `<button type="button" class="lv-gift" data-gift="${esc(g.id)}"><span>${GIFT_ICON[g.id] || "🎁"}</span><b>${esc(g.name)}</b><small>${fmt(g.cost)} B</small></button>`
  ).join("");
  return `
    <div class="lv-room">
      <div class="lv-stage"><span class="lv-stage-badge">LIVE</span>
        <div>${d.kind === "podcast" ? "Audio" : "Video"} joins in the next update. Chat and gifts work now.</div></div>
      <div class="lv-host">
        <div class="lv-avatar">${esc(initials(d.host_username))}</div>
        <div class="lv-hostinfo"><b>${esc(d.host_username || "Host")}</b><div class="ps-note lv-viewers"></div></div>
        <button type="button" class="pf-btn lv-supporters">Supporters</button>
      </div>
      ${d.description ? `<div class="ps-note lv-desc">${esc(d.description)}</div>` : ""}
      <div class="lv-hostbar"></div>
      ${gifts ? `<div class="lv-gifts">${gifts}</div>
        <div class="ps-note lv-balance-line">Available: <span class="lv-balance">${fmt(d.balance)}</span> B · <span class="lv-note"></span></div>` : ""}
      <div class="lv-chat"></div>
      <div class="lv-input"><input class="input-box" maxlength="300" placeholder="Say something…"><button type="button" class="send-btn lv-send">➤</button></div>
    </div>`;
}

function msgHtml(r) {
  if (r.kind === "gift") return `<div class="lv-msg lv-msg-gift">🎁 <b>${esc(r.username || "User")}</b>${esc(r.content)}</div>`;
  if (r.kind === "system") return `<div class="lv-msg lv-msg-system">${esc(r.content)}</div>`;
  return `<div class="lv-msg"><b>${esc(r.username || "User")}</b>${esc(r.content)}</div>`;
}

async function openRoom(id) {
  const sheet = openSheet({ title: "Live", html: SKEL });
  let d;
  try {
    d = await api.getLiveSession(id);
  } catch (e) {
    if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    return;
  }
  if (!sheet.isOpen()) return;
  sheet.setTitle(d.title);
  sheet.setHtml(roomHtml(d));

  const q = (sel) => sheet.body.querySelector(sel);
  const chat = q(".lv-chat");
  const input = q(".lv-input input");
  let afterId = 0, status = d.status, busy = false, timer = 0, noteTimer = 0;

  function note(text) {
    const el = q(".lv-note");
    if (!el) return;
    el.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { el.textContent = ""; }, 3500);
  }

  function paintHost() {
    const bar = q(".lv-hostbar");
    if (!d.is_host) { bar.innerHTML = ""; return; }
    bar.innerHTML = status === "scheduled"
      ? '<button type="button" class="primary-btn lv-start">Start now</button><button type="button" class="pf-btn lv-cancel">Cancel</button>'
      : status === "live" ? '<button type="button" class="pf-btn lv-end">End stream</button>' : "";
  }

  function paintStatus(viewers) {
    const badge = q(".lv-stage-badge");
    const info = q(".lv-viewers");
    if (status === "live") {
      badge.textContent = "LIVE";
      info.textContent = `${fmt(viewers)} watching`;
    } else if (status === "scheduled") {
      badge.textContent = "UPCOMING";
      info.textContent = `Starts ${when(d.scheduled_at)}`;
    } else {
      badge.textContent = status === "cancelled" ? "CANCELLED" : "ENDED";
      info.textContent = "This session has finished.";
    }
    const live = status === "live";
    q(".lv-input").style.display = live ? "" : "none";
    const g = q(".lv-gifts");
    if (g) g.style.display = live ? "" : "none";
    paintHost();
  }

  function appendMsgs(rows) {
    let added = false;
    for (const r of rows) {
      if (r.id <= afterId) continue;
      afterId = r.id;
      chat.insertAdjacentHTML("beforeend", msgHtml(r));
      added = true;
    }
    if (added) chat.scrollTop = chat.scrollHeight;
  }

  async function tick() {
    if (!sheet.isOpen()) return;
    if (!document.hidden) {
      try {
        const r = await api.pollLive(id, afterId);
        status = r.status;
        appendMsgs(r.messages || []);
        paintStatus(r.viewers);
      } catch (e) { /* keep trying */ }
    }
    if (sheet.isOpen() && status !== "ended" && status !== "cancelled") timer = setTimeout(tick, 3000);
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    try {
      appendMsgs([await api.sendLiveMessage(id, text)]);
    } catch (e) {
      note(e.message || "Couldn't send");
      input.value = text;
    }
    busy = false;
  }

  async function sendGift(gid) {
    if (busy) return;
    busy = true;
    try {
      const r = await api.sendLiveGift(id, { gift_id: gid, request_id: uuid() });
      const bal = q(".lv-balance");
      if (bal) bal.textContent = fmt(r.balance);
      note(`${r.gift.name} sent`);
    } catch (e) {
      note(e.message || "Couldn't send the gift");
    }
    busy = false;
  }

  async function act(fn) {
    try {
      await fn();
    } catch (e) {
      alert(e.message || "Couldn't do that");
    }
    clearTimeout(timer);
    tick();
    loadHub();
  }

  sheet.body.addEventListener("click", (e) => {
    if (e.target.closest(".lv-send")) { send(); return; }
    const gift = e.target.closest(".lv-gift");
    if (gift) { sendGift(gift.dataset.gift); return; }
    if (e.target.closest(".lv-supporters")) { openSupporters(id); return; }
    if (e.target.closest(".lv-start")) { act(() => api.startLive(id)); return; }
    if (e.target.closest(".lv-end")) { if (confirm("End this stream?")) act(() => api.endLive(id)); return; }
    if (e.target.closest(".lv-cancel")) { if (confirm("Cancel this session?")) act(() => api.cancelLive(id)); }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); send(); }
  });

  paintStatus(d.viewers);
  tick();
}

async function openSupporters(id) {
  const sheet = openSheet({ title: "Top supporters", html: SKEL });
  try {
    const rows = await api.getLiveSupporters(id);
    sheet.setHtml(rows.length
      ? rows.map((r, i) => `<div class="eco-row"><span>${i + 1}. ${esc(r.username || "User")}</span><b>${fmt(r.points)} pts · ${fmt(r.gifts)} gifts</b></div>`).join("")
      : '<div class="md-muted md-pad">No gifts yet.</div>');
  } catch (e) {
    if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
  }
}

/* -------------------------------- startup -------------------------------- */

function start() {
  // Capture phase: replace the old "coming soon" alert on the Go Live button.
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target.closest("#btn-go-live") : null;
    if (!t) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    showTab("live-video");
    loadHub();
    openGoLive();
  }, true);

  const list = listEl();
  if (list) {
    list.addEventListener("click", async (e) => {
      const card = e.target.closest(".lv-card");
      if (card) { openRoom(card.dataset.id); return; }
      if (e.target.closest(".lv-go")) { openGoLive(); return; }
      if (e.target.closest(".lv-dev-grant")) {
        try {
          await api.devGrant(100000);
          alert("Added 100,000 test Byflints.");
        } catch (err) {
          alert(err.message || "Couldn't add");
        }
      }
    });
  }

  const nav = document.querySelector('.nav-btn[data-tab="live-video"]');
  if (nav) nav.addEventListener("click", loadHub);
  hideComingSoon();
  setInterval(() => {
    const tab = document.getElementById("tab-live-video");
    if (!document.hidden && tab && !tab.classList.contains("hidden")) loadHub();
  }, 30000);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);

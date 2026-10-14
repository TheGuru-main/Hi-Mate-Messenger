// Player tap -> details sheet + follow (favorite). Favorites live on the device for now.
import { openSheet } from "./sheet.js";
import { api, getCachedUser } from "./api.js";

const FAV_KEY = "hm:fav-players:v1";
const DETAIL_PREFIX = "hm:match-detail:v1:";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function loadFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch (e) { return []; }
}
function saveFavs(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}
export function listFavoritePlayers() { return loadFavs(); }

function readDetail(fixtureId) {
  try { return JSON.parse(localStorage.getItem(DETAIL_PREFIX + fixtureId) || "null"); } catch (e) { return null; }
}

function same(a, b, idA, idB) {
  if (idA && idB) return String(idA) === String(idB);
  return !!a && a === b;
}

function gather(d, info) {
  const out = { team: null, teamKey: null, number: "", position: "", lines: [] };
  if (!d) return out;
  const t = d[info.side];
  if (t) { out.team = t.name || null; out.teamKey = t.key || null; }
  const lu = d.lineups && d.lineups[info.side];
  if (lu) {
    const all = [...(lu.starting || []), ...(lu.substitutes || [])];
    const p = all.find((x) => same(x.name, info.name, x.player_id, info.playerId));
    if (p) {
      out.number = p.number || "";
      out.position = p.position || "";
      out.role = (lu.starting || []).includes(p) ? "Starting XI" : "Substitute";
    }
  }
  (d.goals || []).forEach((g) => {
    if (g.side === info.side && same(g.player, info.name, g.player_id, info.playerId))
      out.lines.push(`⚽ Goal ${g.minute}'${g.type === "penalty" ? " (pen)" : g.type === "own_goal" ? " (og)" : ""}`);
    if (g.assist && g.side === info.side && g.assist === info.name)
      out.lines.push(`🅰️ Assist ${g.minute}'`);
  });
  (d.cards || []).forEach((c) => {
    if (c.side === info.side && same(c.player, info.name, c.player_id, info.playerId))
      out.lines.push(`${c.type === "red" ? "🟥 Red" : "🟨 Yellow"} card ${c.minute}'`);
  });
  (d.substitutions || []).forEach((s) => {
    if (s.side !== info.side) return;
    if (same(s.player_in, info.name, s.in_id, info.playerId)) out.lines.push(`🔺 Came on ${s.minute}'`);
    if (s.player_out === info.name) out.lines.push(`🔻 Taken off ${s.minute}'`);
  });
  return out;
}

function html(info, g, following) {
  return `
    <div class="ps-head">
      <div class="ps-num">${esc(g.number || "•")}</div>
      <div class="ps-main">
        <div class="ps-name">${esc(info.name)}</div>
        <div class="ps-sub">${[g.team, g.position, g.role].filter(Boolean).map(esc).join(" · ") || "Player"}</div>
      </div>
    </div>
    <button type="button" class="ps-fav${following ? " ps-fav-on" : ""}">${following ? "★ Following" : "☆ Follow player"}</button>
    ${statsBlock(info)}
    <div class="md-block">
      <div class="md-title">${info.fixtureId ? "This match" : "Followed player"}</div>
      ${g.lines.length ? g.lines.map((l) => `<div class="ps-line">${esc(l)}</div>`).join("")
        : `<div class="md-muted md-pad">${info.fixtureId ? "No recorded events in this match." : "Open any match to see this player's events."}</div>`}
    </div>`;
}

document.addEventListener("hm:player-tap", (event) => {
  const info = event.detail || {};
  if (!info.name) return;
  const g = gather(readDetail(info.fixtureId), info);
  g.team = g.team || info.team || null;
  g.teamKey = g.teamKey || info.teamKey || null;
  g.number = g.number || info.number || "";
  g.position = g.position || info.position || "";
  const id = info.playerId ? `p:${info.playerId}` : `n:${info.name}|${g.team || ""}`;
  let following = loadFavs().some((f) => f.id === id);
  const sheet = openSheet({ title: info.name, html: html(info, g, following) });
  loadProfile(info, () => { if (sheet.isOpen()) sheet.setHtml(html(info, g, following)); });
  sheet.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".ps-fav");
    if (!btn) return;
    let favs = loadFavs();
    if (following) favs = favs.filter((f) => f.id !== id);
    else favs.push({ id, name: info.name, playerId: info.playerId || null, team: g.team, teamKey: g.teamKey, number: g.number, position: g.position, added: Date.now() });
    saveFavs(favs);
    const entry = favs.find((f) => f.id === id);
    if (following) api.unfollowPlayer(id).catch(() => {});
    else if (entry) api.followPlayer(entry).catch(() => {});
    document.dispatchEvent(new CustomEvent("hm:players-changed"));
    following = !following;
    sheet.setHtml(html(info, g, following));
  });
});


/* ---------------- favorite players on the profile page ---------------- */

let profileUid = null;

function ensureBox() {
  let box = document.getElementById("profile-players");
  if (box) return box;
  const anchor = document.getElementById("profile-actions");
  if (!anchor || !anchor.parentNode) return null;
  box = document.createElement("div");
  box.id = "profile-players";
  box.className = "pc-section hidden";
  anchor.parentNode.insertBefore(box, anchor);
  box.addEventListener("click", (event) => {
    const chip = event.target.closest(".pp-chip");
    if (!chip) return;
    const f = loadFavs().find((x) => x.id === chip.dataset.id);
    if (!f) return;
    document.dispatchEvent(new CustomEvent("hm:player-tap", { detail: {
      playerId: f.playerId, name: f.name, side: "club",
      team: f.team, teamKey: f.teamKey, number: f.number, position: f.position } }));
  });
  return box;
}

const FAV_SYNCED = "hm:fav-players:synced";
let lastSync = 0;

async function syncFavs() {
  if (Date.now() - lastSync < 20000) return false;
  lastSync = Date.now();
  try {
    const server = await api.getMyPlayers();
    if (!Array.isArray(server)) return false;
    if (!localStorage.getItem(FAV_SYNCED)) {
      const have = new Set(server.map((s) => s.id));
      for (const f of loadFavs()) {
        if (have.has(f.id)) continue;
        try { await api.followPlayer(f); server.push(f); } catch (e) { /* keep going */ }
      }
      try { localStorage.setItem(FAV_SYNCED, "1"); } catch (e) { /* ignore */ }
    }
    saveFavs(server);
    return true;
  } catch (e) {
    return false;
  }
}

function paintPlayers(box) {
  const favs = loadFavs();
  box.innerHTML = `<div class="pc-section-title">Favorite players</div>` + (favs.length
    ? `<div class="pc-chips">${favs.map((f) => `<button type="button" class="pc-chip pp-chip" data-id="${esc(f.id)}"><span class="pp-chip-num">${esc(f.number || "•")}</span><span>${esc(f.name)}</span></button>`).join("")}</div>`
    : `<div class="md-muted">Tap a player name in any match to view and follow them.</div>`);
  box.classList.remove("hidden");
}

export function renderProfilePlayers(uid, sync = true) {
  profileUid = uid;
  const box = ensureBox();
  if (!box) return;
  let own = false;
  try { const me = getCachedUser(); own = !!(me && String(me.uid) === String(uid)); } catch (e) { /* ignore */ }
  if (!own) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  paintPlayers(box);
  if (sync) syncFavs().then((ok) => { if (ok && profileUid === uid) paintPlayers(box); });
}

document.addEventListener("hm:players-changed", () => { if (profileUid != null) renderProfilePlayers(profileUid, false); });


/* ---------- used by the follow capsules ---------- */

export function playerFavId(info) {
  if (info.playerId) return `p:${info.playerId}`;
  const g = gather(readDetail(info.fixtureId), info);
  return `n:${info.name}|${g.team || info.team || ""}`;
}

export function toggleFavoritePlayer(info) {
  const g = gather(readDetail(info.fixtureId), info);
  g.team = g.team || info.team || null;
  g.teamKey = g.teamKey || info.teamKey || null;
  const id = info.playerId ? `p:${info.playerId}` : `n:${info.name}|${g.team || ""}`;
  let favs = loadFavs();
  const was = favs.some((f) => f.id === id);
  if (was) {
    favs = favs.filter((f) => f.id !== id);
    api.unfollowPlayer(id).catch(() => {});
  } else {
    const entry = { id, name: info.name, playerId: info.playerId || null, team: g.team, teamKey: g.teamKey, number: g.number, position: g.position, added: Date.now() };
    favs.push(entry);
    api.followPlayer(entry).catch(() => {});
  }
  saveFavs(favs);
  document.dispatchEvent(new CustomEvent("hm:players-changed"));
  return !was;
}


/* ---------- real season + career stats ---------- */

const profiles = new Map();
const PROFILE_PREFIX = "hm:player-profile:v1:";
const PROFILE_TTL = 12 * 3600 * 1000;

function readProfileCache(pid) {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_PREFIX + pid) || "null");
    if (raw && Date.now() - raw.t < PROFILE_TTL) return raw.data;
  } catch (e) { /* ignore */ }
  return null;
}

function loadProfile(info, done) {
  const pid = info.playerId ? String(info.playerId) : "";
  if (!pid) return;
  const cached = readProfileCache(pid);
  if (cached) {
    profiles.set(pid, { state: "ok", data: cached });
    done();
    return;
  }
  profiles.set(pid, { state: "loading" });
  api.getPlayerProfile(pid)
    .then((data) => {
      profiles.set(pid, { state: "ok", data });
      try { localStorage.setItem(PROFILE_PREFIX + pid, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* ignore */ }
    })
    .catch((e) => profiles.set(pid, { state: "error", message: (e && e.message) || "unavailable" }))
    .then(done);
}

function psCell(label, value) {
  return `<div class="ps-cell"><div class="ps-val">${esc(value ?? "—")}</div><div class="ps-lab">${esc(label)}</div></div>`;
}

function profileHtml(d) {
  const bits = [d.position, d.age ? `${d.age} yrs` : "", d.country, d.team].filter(Boolean).map(esc).join(" · ");
  const s = d.season;
  const season = s ? `
    <div class="md-block">
      <div class="md-title">This season<span class="md-sub">${esc(s.label || "")}</span></div>
      <div class="ps-grid">
        ${psCell("Apps", s.apps)}${psCell("Minutes", s.minutes)}${psCell("Goals", s.goals)}
        ${psCell("Assists", s.assists)}${psCell("Yellow", s.yellow)}${psCell("Red", s.red)}
        ${s.rating ? psCell("Rating", s.rating) : ""}
      </div>
    </div>` : "";
  const rows = (d.career || []).slice(0, 15).map((r) =>
    `<tr><td>${esc(r.season)}</td><td class="ps-team">${esc(r.teams)}</td><td>${esc(r.apps)}</td><td>${esc(r.goals)}</td><td>${esc(r.assists)}</td></tr>`
  ).join("");
  const t = d.totals || {};
  const career = rows ? `
    <div class="md-block">
      <div class="md-title">Career</div>
      <div class="ps-scroll"><table class="ps-tbl">
        <tr><th>Season</th><th>Team</th><th>Apps</th><th>G</th><th>A</th></tr>
        ${rows}
        <tr class="ps-total"><td>Total</td><td></td><td>${esc(t.apps ?? 0)}</td><td>${esc(t.goals ?? 0)}</td><td>${esc(t.assists ?? 0)}</td></tr>
      </table></div>
    </div>` : "";
  const empty = !season && !career
    ? `<div class="md-block"><div class="md-title">Player stats</div><div class="md-muted md-pad">No season or career data from the provider yet.</div></div>`
    : "";
  return `${bits ? `<div class="md-info">${bits}</div>` : ""}${season}${career}${empty}`;
}

function statsBlock(info) {
  const pid = info.playerId ? String(info.playerId) : "";
  if (!pid) {
    return `<div class="md-block"><div class="md-title">Player stats</div><div class="md-muted md-pad">Season and career stats aren't available for this player.</div></div>`;
  }
  const p = profiles.get(pid);
  if (!p || p.state === "loading") return `<div class="md-skel"></div><div class="md-skel"></div>`;
  if (p.state === "error") {
    return `<div class="md-block"><div class="md-title">Player stats</div><div class="md-muted md-pad">Stats unavailable right now.</div></div>`;
  }
  return profileHtml(p.data);
}

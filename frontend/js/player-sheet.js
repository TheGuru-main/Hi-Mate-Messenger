// Player tap -> details sheet + follow (favorite). Favorites live on the device for now.
import { openSheet } from "./sheet.js";
import { getCachedUser } from "./api.js";

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
  sheet.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".ps-fav");
    if (!btn) return;
    let favs = loadFavs();
    if (following) favs = favs.filter((f) => f.id !== id);
    else favs.push({ id, name: info.name, playerId: info.playerId || null, team: g.team, teamKey: g.teamKey, number: g.number, position: g.position, added: Date.now() });
    saveFavs(favs);
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

export function renderProfilePlayers(uid) {
  profileUid = uid;
  const box = ensureBox();
  if (!box) return;
  let own = false;
  try { const me = getCachedUser(); own = !!(me && String(me.uid) === String(uid)); } catch (e) { /* ignore */ }
  if (!own) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const favs = loadFavs();
  box.innerHTML = `<div class="pc-section-title">Favorite players</div>` + (favs.length
    ? `<div class="pc-chips">${favs.map((f) => `<button type="button" class="pc-chip pp-chip" data-id="${esc(f.id)}"><span class="pp-chip-num">${esc(f.number || "•")}</span><span>${esc(f.name)}</span></button>`).join("")}</div>`
    : `<div class="md-muted">Tap a player name in any match to view and follow them.</div>`);
  box.classList.remove("hidden");
}

document.addEventListener("hm:players-changed", () => { if (profileUid != null) renderProfilePlayers(profileUid); });

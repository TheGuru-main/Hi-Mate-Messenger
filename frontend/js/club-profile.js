// Club profile sheet (opens when a team name is tapped), Follow button, and the
// "Favorite clubs" row on user profiles. Self-initialising: importing this module is enough.
import { api, getCachedUser } from "./api.js";
import { openSheet } from "./sheet.js";

const CACHE_PREFIX = "hm:club:v1:";
const TZ = "UTC";
const memory = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ------------------------------- cache ------------------------------- */

function readCache(id) {
  if (memory.has(id)) return memory.get(id);
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    if (raw) { const v = JSON.parse(raw); memory.set(id, v); return v; }
  } catch (e) { /* ignore */ }
  return null;
}

function writeCache(id, data) {
  memory.set(id, data);
  try { localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(data)); } catch (e) {
    try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch (e2) { /* ignore */ }
  }
}

function signature(d) {
  const { generated_at, ...rest } = d || {};
  return JSON.stringify(rest);
}

/* ------------------------------ rendering ------------------------------ */

function logoHtml(logo, cls) {
  return logo
    ? `<img class="${cls}" src="${esc(logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<span class="${cls} pc-logo-ph">🛡️</span>`;
}

function dateText(row) {
  const t = row.starting_at ? new Date(row.starting_at) : null;
  if (t && !isNaN(t)) return t.toLocaleDateString([], { day: "numeric", month: "short" });
  return esc(row.date || "");
}

function oppLink(row) {
  const name = esc(row.opponent);
  if (!row.opponent_key) return name;
  return `<button type="button" class="pc-link" data-tid="${esc(row.opponent_key)}" data-name="${esc(row.opponent)}" data-logo="${esc(row.opponent_logo || "")}">${name}</button>`;
}

function resultChip(r) {
  return `<span class="md-res md-res-${esc(r)}">${esc(r)}</span>`;
}

function headerHtml(d) {
  const sub = [d.league, d.country].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="pc-head">
      ${logoHtml(d.logo, "pc-logo")}
      <div class="pc-name">${esc(d.name)}</div>
      ${sub ? `<div class="pc-sub">${sub}</div>` : ""}
      <div class="pc-followers">${d.followers ?? 0} follower${d.followers === 1 ? "" : "s"}</div>
      <button type="button" class="pc-follow${d.following ? " pc-follow-on" : ""}" data-act="follow">${d.following ? "Following ✓" : "Follow"}</button>
    </div>`;
}

function overviewHtml(d) {
  const f = d.form;
  let html = "";
  if (f && f.last && f.last.length) {
    const s = f.summary;
    html += `<div class="md-block"><div class="md-title">Form</div>
      <div class="md-chips">${s.results.map(resultChip).join("")}</div>
      <div class="md-info">Last ${s.results.length}: ${s.wins}W ${s.draws}D ${s.losses}L · GF ${s.goals_for} GA ${s.goals_against} · 🟨${s.yellow} 🟥${s.red}</div></div>`;
  }
  if (f && f.next && f.next.length) {
    const n = f.next[0];
    html += `<div class="md-block"><div class="md-title">Next match</div>
      <div class="md-frow"><span class="md-fdate">${dateText(n)}</span><span class="md-fopp">${esc(n.home_away)} · ${oppLink(n)}</span><span class="md-fleague">${esc(n.league)}</span></div></div>`;
  }
  if (d.coaches && d.coaches.length) {
    html += `<div class="md-block"><div class="md-title">Coach</div><div class="md-lp">${esc(d.coaches.join(", "))}</div></div>`;
  }
  if (d.leagues && d.leagues.length > 1) {
    html += `<div class="md-block"><div class="md-title">Competitions</div><div class="md-lp">${d.leagues.map(esc).join(" · ")}</div></div>`;
  }
  if (d.squad_size) html += `<div class="md-info">Squad of ${d.squad_size} players</div>`;
  return html || `<div class="md-muted md-pad">No details available yet.</div>`;
}

function statLine(p) {
  const bits = [];
  if (p.played) bits.push(`${esc(p.played)} app`);
  if (p.goals && p.goals !== "0") bits.push(`⚽${esc(p.goals)}`);
  if (p.yellow && p.yellow !== "0") bits.push(`🟨${esc(p.yellow)}`);
  if (p.red && p.red !== "0") bits.push(`🟥${esc(p.red)}`);
  return bits.join(" · ");
}

function squadHtml(d) {
  if (!d.squad || !d.squad.length) return `<div class="md-muted md-pad">Squad not available right now.</div>`;
  return d.squad.map((g) => `
    <div class="md-block">
      <div class="md-title">${esc(g.position)}<span class="md-sub">${g.players.length}</span></div>
      ${g.players.map((p) => `
        <div class="md-lp">
          <span class="md-num">${esc(p.number)}</span>
          <button type="button" class="md-player" data-pid="${esc(p.player_id ?? "")}" data-name="${esc(p.name)}" data-side="club">${esc(p.name)}</button>
          ${p.injured ? `<span class="md-badges">🩹</span>` : ""}
          <span class="md-pos">${p.age ? esc(p.age) + "y" : ""}</span>
          <span class="md-badges">${statLine(p)}</span>
        </div>`).join("")}
    </div>`).join("");
}

function fixturesHtml(d) {
  const f = d.form;
  if (!f) return `<div class="md-muted md-pad">Fixtures unavailable right now.</div>`;
  const last = f.last.map((r) => `
    <div class="md-frow">${resultChip(r.result)}<span class="md-fdate">${dateText(r)}</span>
      <span class="md-fopp">${esc(r.home_away)} · ${oppLink(r)}</span><span class="md-fscore">${r.for}-${r.against}</span></div>`).join("");
  const next = f.next.map((r) => `
    <div class="md-frow"><span class="md-fdate">${dateText(r)}</span>
      <span class="md-fopp">${esc(r.home_away)} · ${oppLink(r)}</span><span class="md-fleague">${esc(r.league)}</span></div>`).join("");
  return `<div class="md-block"><div class="md-title">Last ${f.last.length} matches</div>${last || `<div class="md-muted">No recent matches.</div>`}</div>
          <div class="md-block"><div class="md-title">Next ${f.next.length} fixtures</div>${next || `<div class="md-muted">No fixtures scheduled.</div>`}</div>`;
}

const TABS = [["overview", "Overview"], ["squad", "Squad"], ["fixtures", "Fixtures"]];

export function clubHtml(d, tab = "overview") {
  const panels = { overview: overviewHtml, squad: squadHtml, fixtures: fixturesHtml };
  const tabs = TABS.map(([k, label]) => `<button type="button" class="md-tab${k === tab ? " md-tab-on" : ""}" data-tab="${k}">${label}</button>`).join("");
  return `${headerHtml(d)}<div class="md-tabs">${tabs}</div><div class="md-panel">${(panels[tab] || overviewHtml)(d)}</div>`;
}

/* ------------------------------ the sheet ------------------------------ */

const clubsChanged = () => document.dispatchEvent(new CustomEvent("hm:clubs-changed"));

export async function openClubProfile({ teamKey, name = "", logo = "", sport = "football" }) {
  if (!teamKey) return;
  const id = `${sport}:${teamKey}`;
  const sheet = openSheet({
    title: name || "Club",
    html: `<div class="pc-head">${logoHtml(logo, "pc-logo")}<div class="pc-name">${esc(name)}</div></div><div class="md-skel"></div><div class="md-skel"></div>`,
  });
  let data = readCache(id);
  let tab = "overview";
  let busy = false;
  const paint = () => { if (data && sheet.isOpen()) { sheet.setTitle(data.name || name || "Club"); sheet.setHtml(clubHtml(data, tab)); } };
  if (data) paint();

  sheet.body.addEventListener("click", async (event) => {
    const t = event.target.closest(".md-tab");
    if (t) { tab = t.dataset.tab; paint(); return; }
    const link = event.target.closest(".pc-link");
    if (link) { openClubProfile({ teamKey: link.dataset.tid, name: link.dataset.name, logo: link.dataset.logo, sport }); return; }
    const player = event.target.closest(".md-player");
    if (player) {
      document.dispatchEvent(new CustomEvent("hm:player-tap", { detail: {
        playerId: player.dataset.pid || null, name: player.dataset.name, side: "club", teamKey } }));
      return;
    }
    const follow = event.target.closest(".pc-follow");
    if (follow && data && !busy) {
      busy = true;
      const was = !!data.following;
      data = { ...data, following: !was, followers: Math.max(0, (data.followers || 0) + (was ? -1 : 1)) };
      paint();
      try {
        const res = was
          ? await api.unfollowClub(teamKey, sport)
          : await api.followClub(teamKey, { name: data.name || name, logo: data.logo || logo || null }, sport);
        data = { ...data, following: !!res.following, followers: res.followers ?? data.followers };
        writeCache(id, data);
        clubsChanged();
      } catch (e) {
        data = { ...data, following: was, followers: Math.max(0, (data.followers || 0) + (was ? 1 : -1)) };
        paint();
        const btn = sheet.body.querySelector(".pc-follow");
        if (btn) { btn.textContent = e.message || "Couldn't update"; setTimeout(paint, 1800); }
      }
      paint();
      busy = false;
    }
  });

  try {
    const fresh = await api.getClubProfile(teamKey, sport, name, logo);
    if (!sheet.isOpen()) return;
    if (!data || signature(fresh) !== signature(data)) { data = fresh; paint(); }
    writeCache(id, fresh);
  } catch (e) {
    if (!data && sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
  }
}

/* --------------------- favorite clubs on the profile page --------------------- */

let profileUid = null;

function ensureBox() {
  let box = document.getElementById("profile-clubs");
  if (box) return box;
  const anchor = document.getElementById("profile-actions");
  if (!anchor || !anchor.parentNode) return null;
  box = document.createElement("div");
  box.id = "profile-clubs";
  box.className = "pc-section hidden";
  anchor.parentNode.insertBefore(box, anchor);
  box.addEventListener("click", (event) => {
    const chip = event.target.closest(".pc-chip");
    if (chip) openClubProfile({ teamKey: chip.dataset.key, name: chip.dataset.name, logo: chip.dataset.logo, sport: chip.dataset.sport });
  });
  return box;
}

export function clubChipsHtml(list) {
  return `<div class="pc-section-title">Favorite clubs</div><div class="pc-chips">${list.map((c) => `
    <button type="button" class="pc-chip" data-key="${esc(c.team_key)}" data-name="${esc(c.name)}" data-logo="${esc(c.logo || "")}" data-sport="${esc(c.sport || "football")}">
      ${logoHtml(c.logo, "pc-chip-logo")}<span>${esc(c.name)}</span></button>`).join("")}</div>`;
}

export function clearProfileClubs() {
  const box = ensureBox();
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
}

export async function renderProfileClubs(uid) {
  profileUid = uid;
  const box = ensureBox();
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
  let me = null;
  try { me = getCachedUser ? getCachedUser() : null; } catch (e) { /* ignore */ }
  const own = !!(me && String(me.uid) === String(uid));
  try {
    const list = own ? await api.getMyClubs() : await api.getUserClubs(uid);
    if (profileUid !== uid) return;
    if (list.length) {
      box.innerHTML = clubChipsHtml(list);
      box.classList.remove("hidden");
    } else if (own) {
      box.innerHTML = `<div class="pc-section-title">Favorite clubs</div><div class="md-muted">Tap a club name in any match to view it and follow it.</div>`;
      box.classList.remove("hidden");
    }
  } catch (e) { /* keep the section hidden */ }
}

/* ------------------------------- wiring ------------------------------- */

if (!globalThis.__hmClubsWired) {
  globalThis.__hmClubsWired = true;
  document.addEventListener("hm:team-tap", (event) => {
    const d = event.detail || {};
    openClubProfile({ teamKey: d.teamKey, name: d.name, logo: d.logo, sport: "football" });
  });
  document.addEventListener("hm:clubs-changed", () => { if (profileUid) renderProfileClubs(profileUid); });
}

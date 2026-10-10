// Match detail fold: summary (goals/cards/subs), lineups, form (last 5 + next 15), stats.
// Paints instantly from the local cache (or skeleton), then refreshes in the background.
import { api } from "./api.js";

const CACHE_PREFIX = "hm:match-detail:v1:";
const LIVE_REFRESH_MS = 20000;
const TABS = [
  ["summary", "Summary"],
  ["lineups", "Lineups"],
  ["form", "Form"],
  ["stats", "Stats"],
];
const memory = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ------------------------------ cache ------------------------------ */

function readCache(id) {
  if (memory.has(id)) return memory.get(id);
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    if (raw) {
      const value = JSON.parse(raw);
      memory.set(id, value);
      return value;
    }
  } catch (e) { /* storage unavailable */ }
  return null;
}

function writeCache(id, data) {
  memory.set(id, data);
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(data));
  } catch (e) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e2) { /* ignore */ }
  }
}

function signature(data) {
  const { generated_at, ...rest } = data || {};
  return JSON.stringify(rest);
}

/* ----------------------------- renderers ---------------------------- */

function playerBtn(name, id, side) {
  if (!name) return "";
  return `<button type="button" class="md-player" data-pid="${esc(id ?? "")}" data-name="${esc(name)}" data-side="${esc(side)}">${esc(name)}</button>`;
}

function teamBtn(team) {
  if (!team || !team.name) return "";
  return `<button type="button" class="md-team" data-tid="${esc(team.key ?? "")}" data-name="${esc(team.name)}" data-logo="${esc(team.logo ?? "")}">${esc(team.name)}</button>`;
}

function goalTag(type) {
  return type === "penalty" ? " (pen)" : type === "own_goal" ? " (og)" : "";
}

function minuteNum(text) {
  const m = String(text || "").match(/^\s*(\d+)(?:\s*\+\s*(\d+))?/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0) : 999;
}

function renderScorers(d) {
  const col = (side) => {
    const rows = d.goals.filter((g) => g.side === side);
    if (!rows.length) return `<div class="md-muted">—</div>`;
    return rows.map((g) =>
      `<div class="md-scorer">${playerBtn(g.player, g.player_id, side)}<span class="md-min">${esc(g.minute)}'${goalTag(g.type)}</span></div>`
    ).join("");
  };
  return `
    <div class="md-block">
      <div class="md-title">Goalscorers</div>
      <div class="md-two">
        <div class="md-col md-col-home">${col("home")}</div>
        <div class="md-col md-col-away">${col("away")}</div>
      </div>
    </div>`;
}

function renderCardTotals(d) {
  const t = d.card_totals || {};
  const chip = (side) => {
    const x = t[side] || { yellow: 0, red: 0 };
    return `<span class="md-chip">🟨 ${x.yellow}</span><span class="md-chip">🟥 ${x.red}</span>`;
  };
  return `
    <div class="md-block">
      <div class="md-title">Cards</div>
      <div class="md-two">
        <div class="md-col md-col-home">${chip("home")}</div>
        <div class="md-col md-col-away">${chip("away")}</div>
      </div>
    </div>`;
}

function renderTimeline(d) {
  const items = [
    ...d.goals.map((g) => ({
      minute: g.minute, side: g.side, icon: "⚽",
      html: `${playerBtn(g.player, g.player_id, g.side)}${goalTag(g.type)}${g.assist ? `<span class="md-sub">assist: ${esc(g.assist)}</span>` : ""}`,
    })),
    ...d.cards.map((c) => ({
      minute: c.minute, side: c.side, icon: c.type === "red" ? "🟥" : "🟨",
      html: playerBtn(c.player, c.player_id, c.side),
    })),
    ...d.substitutions.map((s) => ({
      minute: s.minute, side: s.side, icon: "🔁",
      html: `${playerBtn(s.player_in, s.in_id, s.side)}<span class="md-sub">for ${esc(s.player_out)}</span>`,
    })),
  ].sort((a, b) => minuteNum(a.minute) - minuteNum(b.minute));

  if (!items.length) return "";
  return `
    <div class="md-block">
      <div class="md-title">Timeline</div>
      ${items.map((i) => `
        <div class="md-ev md-ev-${i.side}">
          <span class="md-min">${esc(i.minute)}'</span>
          <span class="md-ico">${i.icon}</span>
          <span class="md-ev-body">${i.html}</span>
        </div>`).join("")}
    </div>`;
}

function renderSummary(d) {
  const nothingYet = !d.goals.length && !d.cards.length && !d.substitutions.length;
  const score = d.score && d.score.home != null ? `${d.score.home} - ${d.score.away}` : "";
  const info = [d.info.league, d.info.round, d.info.stadium, d.info.referee && `Ref: ${d.info.referee}`]
    .filter(Boolean).map(esc).join(" · ");
  return `
    ${info ? `<div class="md-info">${info}</div>` : ""}
    ${d.score && d.score.halftime ? `<div class="md-info">HT ${esc(d.score.halftime)}${score ? ` · ${esc(score)}` : ""}</div>` : ""}
    ${nothingYet ? `<div class="md-muted md-pad">No goals, cards or substitutions yet.</div>` : `
      ${renderScorers(d)}${renderCardTotals(d)}${renderTimeline(d)}`}`;
}

function badges(p) {
  const b = [];
  if (p.goals) b.push(`⚽${p.goals > 1 ? "×" + p.goals : ""}`);
  if (p.assists) b.push(`🅰️${p.assists > 1 ? "×" + p.assists : ""}`);
  if (p.yellow) b.push("🟨");
  if (p.red) b.push("🟥");
  if (p.sub_out) b.push(`🔻${esc(p.sub_out)}'`);
  if (p.sub_in) b.push(`🔺${esc(p.sub_in)}'`);
  return b.length ? `<span class="md-badges">${b.join(" ")}</span>` : "";
}

function playerRow(p, side) {
  return `
    <div class="md-lp">
      <span class="md-num">${esc(p.number)}</span>
      ${playerBtn(p.name, p.player_id, side)}
      <span class="md-pos">${esc(p.position)}</span>
      ${badges(p)}
    </div>`;
}

function renderLineupSide(team, lu, side) {
  const empty = !lu.starting.length && !lu.substitutes.length;
  return `
    <div class="md-block">
      <div class="md-title">${teamBtn(team)}${lu.formation ? `<span class="md-sub">${esc(lu.formation)}</span>` : ""}</div>
      ${empty ? `<div class="md-muted md-pad">Lineup not announced yet.</div>` : `
        ${lu.starting.map((p) => playerRow(p, side)).join("")}
        ${lu.substitutes.length ? `<div class="md-subtitle">Substitutes</div>${lu.substitutes.map((p) => playerRow(p, side)).join("")}` : ""}
        ${lu.coaches.length ? `<div class="md-subtitle">Coach</div><div class="md-lp">${esc(lu.coaches.join(", "))}</div>` : ""}
        ${lu.missing.length ? `<div class="md-subtitle">Injured / missing</div>${lu.missing.map((m) => `
          <div class="md-lp">${playerBtn(m.name, m.player_id, side)}<span class="md-pos">${esc(m.reason)}</span></div>`).join("")}` : ""}`}
    </div>`;
}

function renderLineups(d) {
  return renderLineupSide(d.home, d.lineups.home, "home") + renderLineupSide(d.away, d.lineups.away, "away");
}

function resultChip(r) {
  return `<span class="md-res md-res-${esc(r)}">${esc(r)}</span>`;
}

function dateText(row) {
  if (!row.date) return "";
  const t = row.starting_at ? new Date(row.starting_at) : null;
  if (t && !isNaN(t)) {
    return t.toLocaleDateString([], { day: "numeric", month: "short" });
  }
  return esc(row.date);
}

function renderFormTeam(team, form) {
  if (!form) {
    return `<div class="md-block"><div class="md-title">${teamBtn(team)}</div><div class="md-muted md-pad">Form unavailable right now.</div></div>`;
  }
  const s = form.summary;
  const last = form.last.map((r) => `
    <div class="md-frow">
      ${resultChip(r.result)}
      <span class="md-fdate">${dateText(r)}</span>
      <span class="md-fopp">${esc(r.home_away)} · ${esc(r.opponent)}</span>
      <span class="md-fscore">${r.for}-${r.against}</span>
      <span class="md-fcards">${r.yellow ? `🟨${r.yellow}` : ""}${r.red ? ` 🟥${r.red}` : ""}</span>
    </div>`).join("");
  const next = form.next.map((r) => `
    <div class="md-frow">
      <span class="md-fdate">${dateText(r)}</span>
      <span class="md-fopp">${esc(r.home_away)} · ${esc(r.opponent)}</span>
      <span class="md-fleague">${esc(r.league)}</span>
    </div>`).join("");
  return `
    <div class="md-block">
      <div class="md-title">${teamBtn(team)}</div>
      <div class="md-chips">${s.results.map(resultChip).join("")}</div>
      <div class="md-info">Last ${s.results.length}: ${s.wins}W ${s.draws}D ${s.losses}L · GF ${s.goals_for} GA ${s.goals_against} · 🟨${s.yellow} 🟥${s.red}</div>
      <div class="md-subtitle">Last ${form.last.length} matches</div>${last || `<div class="md-muted">No recent matches.</div>`}
      <div class="md-subtitle">Next ${form.next.length} opponents</div>${next || `<div class="md-muted">No fixtures scheduled.</div>`}
    </div>`;
}

function renderForm(d) {
  return renderFormTeam(d.home, d.form.home) + renderFormTeam(d.away, d.form.away);
}

function num(value) {
  const n = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

function renderStats(d) {
  if (!d.statistics.length) return `<div class="md-muted md-pad">No statistics available.</div>`;
  return `<div class="md-block">${d.statistics.map((r) => {
    const h = num(r.home), a = num(r.away), total = h + a || 1;
    return `
      <div class="md-stat">
        <div class="md-stat-row"><span>${esc(r.home)}</span><span class="md-stat-name">${esc(r.type)}</span><span>${esc(r.away)}</span></div>
        <div class="md-bar"><i class="md-bar-home" style="width:${(h / total) * 100}%"></i><i class="md-bar-away" style="width:${(a / total) * 100}%"></i></div>
      </div>`;
  }).join("")}</div>`;
}

export function renderMatchDetail(d, tab = "summary") {
  const panels = { summary: renderSummary, lineups: renderLineups, form: renderForm, stats: renderStats };
  const tabs = TABS.map(([key, label]) =>
    `<button type="button" class="md-tab${key === tab ? " md-tab-on" : ""}" data-tab="${key}">${label}</button>`
  ).join("");
  return `<div class="md-tabs">${tabs}</div><div class="md-panel">${(panels[tab] || renderSummary)(d)}</div>`;
}

function skeleton() {
  return `<div class="md-skel"></div><div class="md-skel"></div><div class="md-skel md-skel-short"></div>`;
}

/* ------------------------------- mount ------------------------------ */

function bind(container) {
  if (container._mdBound) return;
  container._mdBound = true;
  container.addEventListener("click", (event) => {
    const tab = event.target.closest(".md-tab");
    if (tab) {
      container._mdTab = tab.dataset.tab;
      if (container._mdData) container.innerHTML = renderMatchDetail(container._mdData, container._mdTab);
      return;
    }
    const player = event.target.closest(".md-player");
    if (player) {
      document.dispatchEvent(new CustomEvent("hm:player-tap", { detail: {
        playerId: player.dataset.pid || null, name: player.dataset.name, side: player.dataset.side,
        fixtureId: container._mdFixture,
      } }));
      return;
    }
    const team = event.target.closest(".md-team");
    if (team) {
      document.dispatchEvent(new CustomEvent("hm:team-tap", { detail: {
        teamKey: team.dataset.tid || null, name: team.dataset.name, logo: team.dataset.logo || null,
      } }));
    }
  });
}

function paint(container, data) {
  container._mdData = data;
  container._mdSig = signature(data);
  container.innerHTML = renderMatchDetail(data, container._mdTab || "summary");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mountMatchDetail(fixtureId, container, hints = {}) {
  if (!container) return;
  bind(container);

  // matches.js re-calls loadStatsFold on every room poll. If this match is already
  // mounted and was refreshed moments ago, leave the DOM and the live loop alone.
  const sameFixture = container._mdMounted === fixtureId && !!container._mdData;
  if (sameFixture && Date.now() - (container._mdLastRefresh || 0) < 8000) return;

  const token = {};
  container._mdToken = token;
  container._mdFixture = fixtureId;
  if (!sameFixture) container._mdTab = "summary";
  const alive = () => container.isConnected && container._mdToken === token;

  const cached = readCache(fixtureId);
  if (!sameFixture) {
    if (cached) paint(container, cached);
    else container.innerHTML = skeleton();
  }
  container._mdMounted = fixtureId;

  const query = hints.home_team_key && hints.away_team_key
    ? `?home_key=${encodeURIComponent(hints.home_team_key)}&away_key=${encodeURIComponent(hints.away_team_key)}`
    : "";

  async function refresh() {
    const fresh = await api.getMatchDetail(fixtureId, query);
    if (!alive()) return null;
    container._mdLastRefresh = Date.now();
    writeCache(fixtureId, fresh);
    if (signature(fresh) !== container._mdSig) paint(container, fresh);
    return fresh;
  }

  let data = null;
  try {
    data = await refresh();
  } catch (e) {
    if (!cached && !sameFixture) throw e; // nothing to show -> caller falls back to the legacy stats view
  }

  if (data && data.live) {
    (async () => {
      while (alive()) {
        await sleep(LIVE_REFRESH_MS);
        if (!alive()) break;
        if (document.hidden) continue;
        try {
          const d = await refresh();
          if (d && !d.live) break;
        } catch (e) { /* keep last good view */ }
      }
    })();
  }
}

export function prefetchMatchDetail(fixtureId, hints = {}) {
  if (readCache(fixtureId)) return;
  const query = hints.home_team_key && hints.away_team_key
    ? `?home_key=${encodeURIComponent(hints.home_team_key)}&away_key=${encodeURIComponent(hints.away_team_key)}`
    : "";
  api.getMatchDetail(fixtureId, query).then((d) => writeCache(fixtureId, d)).catch(() => {});
}

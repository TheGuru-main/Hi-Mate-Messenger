// Other sports (basketball / tennis / cricket) for the LiveSports tab:
// sport selector row, sport-aware result cards, and a match detail sheet.
import { api } from "./api.js";
import { openSheet } from "./sheet.js";

export const SPORTS = [
  ["football", "⚽", "Football"],
  ["basketball", "🏀", "Basketball"],
  ["tennis", "🎾", "Tennis"],
  ["cricket", "🏏", "Cricket"],
];
const REFRESH_MS = 20000;
const DAYS = 3;
const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
})();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ----------------------------- shared helpers ----------------------------- */

export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return "Earlier";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

export function groupResults(list, scopeSel) {
  if (scopeSel === "past") {
    const groups = [];
    for (const m of list) {
      const label = dayLabel(m.starting_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(m);
      else groups.push({ label, items: [m] });
    }
    return groups;
  }
  if (scopeSel === "all") {
    const defs = [["live", "Live now"], ["upcoming", "Upcoming"], ["past", "Past matches"]];
    return defs
      .map(([key, label]) => ({ label, items: list.filter((m) => m.scope === key) }))
      .filter((g) => g.items.length);
  }
  return [{ label: "", items: list }];
}

function kickoffText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "UPCOMING";
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* -------------------------------- cards -------------------------------- */

function periodLine(m) {
  if (!m.periods || !m.periods.length) return "";
  return `<div class="ms-periods">${m.periods.map((p) =>
    `<span>${esc(p.label.replace("Set ", "S"))} ${p.home ?? "–"}-${p.away ?? "–"}</span>`).join("")}</div>`;
}

function scoreCell(m) {
  if (m.upcoming) return "vs";
  if (m.sport === "cricket") return `${esc(m.home_score_text || "–")}<small> / </small>${esc(m.away_score_text || "–")}`;
  return `${esc(m.home_score_text || "0")} - ${esc(m.away_score_text || "0")}`;
}

function statusCell(m) {
  if (m.upcoming) return `Kickoff ${esc(kickoffText(m.starting_at))}`;
  if (m.live) return `${esc(m.status_text || "LIVE")} · LIVE${m.game_score ? ` · ${esc(m.game_score)}` : ""}`;
  return `${esc(m.status_text || "FT")}${m.starting_at ? ` · ${esc(dayLabel(m.starting_at))}` : ""}`;
}

export function sportCardHtml(m) {
  const winH = m.winner === "home" ? " ms-win" : "";
  const winA = m.winner === "away" ? " ms-win" : "";
  const serveH = m.serving === "home" ? " 🎾" : "";
  const serveA = m.serving === "away" ? " 🎾" : "";
  const sub = [m.league, m.round || m.match_type].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="match-search-result-icon"><i class="fa-solid fa-shield-halved"></i></div>
    <div class="match-search-result-main">
      <div class="match-search-result-clubs ms-clubs">
        <span class="ms-team${winH}">${esc(m.home_team || "?")}${serveH}</span>
        <span class="ms-score${m.finished ? " ms-score-ft" : ""}">${scoreCell(m)}</span>
        <span class="ms-team${winA}">${esc(m.away_team || "?")}${serveA}</span>
      </div>
      <div class="match-search-result-meta">${statusCell(m)}${sub ? ` · ${sub}` : ""}</div>
      ${m.sport === "cricket" && m.finished ? "" : periodLine(m)}
    </div>
    <i class="fa-solid fa-chevron-right"></i>`;
}

/* ------------------------------- detail -------------------------------- */

function periodTable(d) {
  if (!d.periods || !d.periods.length) return "";
  const head = d.sport === "tennis" ? "Sets" : "Periods";
  return `
    <div class="md-block">
      <div class="md-title">${head}</div>
      <table class="sp-table">
        <tr><th></th>${d.periods.map((p) => `<th>${esc(p.label)}</th>`).join("")}</tr>
        <tr><td>${esc(d.home_team)}</td>${d.periods.map((p) => `<td>${p.home ?? "–"}</td>`).join("")}</tr>
        <tr><td>${esc(d.away_team)}</td>${d.periods.map((p) => `<td>${p.away ?? "–"}</td>`).join("")}</tr>
      </table>
    </div>`;
}

function statBars(rows) {
  const num = (v) => { const n = parseFloat(String(v).replace("%", "")); return Number.isFinite(n) ? n : 0; };
  return `<div class="md-block"><div class="md-title">Statistics</div>${rows.map((r) => {
    const h = num(r.home), a = num(r.away), t = h + a || 1;
    return `<div class="md-stat">
      <div class="md-stat-row"><span>${esc(r.home)}</span><span class="md-stat-name">${esc(r.type)}</span><span>${esc(r.away)}</span></div>
      <div class="md-bar"><i class="md-bar-home" style="width:${(h / t) * 100}%"></i><i class="md-bar-away" style="width:${(a / t) * 100}%"></i></div>
    </div>`;
  }).join("")}</div>`;
}

function infoRows(pairs) {
  const rows = pairs.filter(([, v]) => v);
  if (!rows.length) return "";
  return `<div class="md-block"><div class="md-title">Match info</div>${rows.map(([k, v]) =>
    `<div class="sp-info"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")}</div>`;
}

export function detailHtml(d) {
  const x = d.extras || {};
  const winH = d.winner === "home" ? " ms-win" : "";
  const winA = d.winner === "away" ? " ms-win" : "";
  const head = `
    <div class="sp-head">
      <div class="sp-sub">${[d.league, d.country, d.round].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="sp-board">
        <div class="sp-side${winH}">${esc(d.home_team)}</div>
        <div class="sp-score">${scoreCell(d)}</div>
        <div class="sp-side${winA}">${esc(d.away_team)}</div>
      </div>
      <div class="sp-status">${statusCell(d)}</div>
    </div>`;
  let body = periodTable(d);
  if (d.sport === "basketball" && x.statistics && x.statistics.length) body += statBars(x.statistics);
  if (d.sport === "cricket") {
    body += infoRows([
      ["Result", x.result], ["Format", d.match_type], ["Toss", x.toss], ["Player of the match", x.man_of_match],
      ["Venue", x.stadium], [`${d.home_team} run rate`, x.home_rr], [`${d.away_team} run rate`, x.away_rr],
    ]);
  }
  if (d.sport === "tennis") {
    body += infoRows([["Tour", d.country], ["Round", d.round], ["Current game", d.game_score],
      ["Winner", d.winner === "home" ? d.home_team : d.winner === "away" ? d.away_team : ""]]);
  }
  if (d.sport === "basketball") body += infoRows([["League", d.league], ["Country", d.country]]);
  return head + (body || `<div class="md-muted md-pad">More details appear once the match starts.</div>`);
}

function signature(d) {
  const { generated_at, ...rest } = d || {};
  return JSON.stringify(rest);
}

export async function openSportDetail(m) {
  const sheet = openSheet({ title: `${m.home_team} v ${m.away_team}`, html: `<div class="md-skel"></div><div class="md-skel"></div>` });
  let sig = "";
  let live = false;
  async function load(first) {
    try {
      const d = await api.getSportDetail(m.sport, m.fixture_id, TZ);
      if (!sheet.isOpen()) return;
      live = !!d.live;
      if (signature(d) !== sig) { sig = signature(d); sheet.setHtml(detailHtml(d)); }
    } catch (e) {
      if (first && sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    }
  }
  await load(true);
  (async () => {
    while (sheet.isOpen() && live) {
      await new Promise((r) => setTimeout(r, REFRESH_MS));
      if (!sheet.isOpen()) break;
      if (!document.hidden) await load(false);
    }
  })();
}

/* ------------------------- selector + list rendering ------------------------- */

const listCache = new Map();

/* -------------------- existing sport dropdown (populated, not replaced) -------------------- */

const FOOTBALL_RE = /football|soccer/i;

function explicitKey(option) {
  const hint = option.dataset && option.dataset.hmSport;
  if (hint) return hint;
  const text = `${option.value} ${option.textContent}`;
  if (FOOTBALL_RE.test(text)) return "football";
  const low = text.toLowerCase();
  for (const [key] of SPORTS) if (key !== "football" && low.includes(key)) return key;
  return null;
}

function hasFootballOption(select) {
  return Array.from(select.options || []).some((o) => FOOTBALL_RE.test(`${o.value} ${o.textContent}`));
}

function findSportSelect(root) {
  const pick = (scope) => Array.from(scope.querySelectorAll("select")).find(hasFootballOption) || null;
  return pick(root) || pick(document);
}

function populate(select) {
  const present = new Set(Array.from(select.options).map(explicitKey).filter(Boolean));
  for (const [key, emoji, label] of SPORTS) {
    if (present.has(key)) continue;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${emoji} ${label}`;
    opt.dataset.hmSport = key;
    select.appendChild(opt);
  }
}

function selectedSport(select) {
  const opt = select.options[select.selectedIndex];
  return (opt && explicitKey(opt)) || "football";
}

export function createSportsMore({ onChange }) {
  let sport = "football";
  let shell = null;
  let select = null;
  let resultsMode = false;
  let timer = null;

  function applyVisibility() {
    if (!shell) return;
    const hide = sport !== "football" || resultsMode;
    const keep = (el) => el.id === "matches-search-results"
      || (select && (el === select || (el.contains && el.contains(select))))
      || ["livesports-header", "livesports-search", "ms-scopes", "hm-sheet"].some((c) => el.classList.contains(c));
    Array.from(shell.children).forEach((el) => {
      el.classList.toggle("ms-football-hidden", hide && !keep(el));
    });
  }

  function paint(results, list, query, scope) {
    results.innerHTML = "";
    if (!list.length) {
      const where = scope === "all" ? "live, upcoming or recent" : scope;
      results.innerHTML = `<div class="match-search-empty"><i class="fa-solid fa-magnifying-glass"></i>
        ${query ? `No ${esc(where)} ${esc(sport)} found for <strong>${esc(query)}</strong>.` : `No ${esc(where)} ${esc(sport)} matches right now.`}</div>`;
      return;
    }
    for (const group of groupResults(list, scope)) {
      if (group.label) {
        const h = document.createElement("div");
        h.className = "ms-group";
        h.textContent = group.label;
        results.appendChild(h);
      }
      for (const m of group.items) {
        const div = document.createElement("div");
        div.className = "match-search-result";
        div.innerHTML = sportCardHtml(m);
        div.onclick = () => openSportDetail(m);
        results.appendChild(div);
      }
    }
  }

  return {
    active: () => sport !== "football",
    setResultsMode(flag) { resultsMode = !!flag; applyVisibility(); },
    attach(parent) {
      shell = parent;
      select = findSportSelect(parent);
      if (!select) {
        // No dropdown with a football option was found: add a compact one rather than lose the feature.
        select = document.createElement("select");
        select.className = "ms-sport-select";
        const base = document.createElement("option");
        base.value = "football";
        base.textContent = "⚽ Football";
        select.appendChild(base);
        const searchBlock = parent.querySelector(".livesports-search");
        parent.insertBefore(select, searchBlock || parent.children[1] || null);
        console.warn("[hi-mate] no football sport dropdown found; added one");
      }
      populate(select);
      sport = selectedSport(select);
      select.addEventListener("change", () => {
        const next = selectedSport(select);
        if (next === sport) return;
        sport = next;
        clearTimeout(timer);
        applyVisibility();
        onChange();
      });
      applyVisibility();
    },
    async render({ query, scope, results, stillCurrent, refresh }) {
      clearTimeout(timer);
      const key = `${sport}|${scope}|${query}`;
      const cached = listCache.get(key);
      if (cached) paint(results, cached.list, query, scope);
      else results.innerHTML = `<div class="match-search-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading ${esc(sport)}…</div>`;
      try {
        const list = await api.getSportList(sport, scope, query, DAYS, TZ);
        if (!stillCurrent()) return;
        const sig = JSON.stringify(list);
        if (!cached || cached.sig !== sig) paint(results, list, query, scope);
        listCache.set(key, { list, sig });
        if (list.some((m) => m.live)) {
          const tick = () => {
            if (!this.active()) return;
            if (document.hidden) { timer = setTimeout(tick, REFRESH_MS); return; }
            refresh();
          };
          timer = setTimeout(tick, REFRESH_MS);
        }
      } catch (e) {
        if (!stillCurrent() || cached) return;
        results.innerHTML = `<div class="match-data-error">${esc(e.message)}</div>`;
      }
    },
  };
}

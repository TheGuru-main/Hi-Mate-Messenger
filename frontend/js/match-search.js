// LiveSports search v2: scope toggles (All / Live / Upcoming / Past 3d), past-matches feed,
// grouped results with scorers for finished games. Replaces the legacy input wiring.
import { api } from "./api.js";
import { createSportsMore, dayLabel, groupResults } from "./sports-more.js";
import { footballCardEl } from "./match-card.js";

export { dayLabel, groupResults };

const SCOPES = [
  ["all", "All"],
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["past", "Past 3d"],
];
const DAYS = 3;
const PERSIST_PREFIX = "hm:ms-list:v1:";
const REFRESH_MS = 20000;

let scope = "all";   // "All" is always on by default
let scopeRow = null;
let ticket = 0;
let refreshTimer = null;
let sports = null;
const listCache = new Map();

const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
})();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ----------------------------- helpers ----------------------------- */

function kickoffText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "UPCOMING";
  return "Kickoff " + d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function goalTag(type) {
  return type === "penalty" ? " (pen)" : type === "own_goal" ? " (og)" : "";
}

function goalsLine(m) {
  const goals = m.goals || [];
  if (!goals.length) return "";
  const fmt = (g) => `${esc(g.player)} ${esc(g.minute)}'${goalTag(g.type)}`;
  const side = (s) => goals.filter((g) => g.side === s).map(fmt).join(", ") || "–";
  return `<div class="ms-goals"><span>${side("home")}</span><span>${side("away")}</span></div>`;
}

export function resultHtml(m, deps) {
  const finished = !!m.finished || m.scope === "past";
  let status;
  if (finished) status = `FT · ${esc(dayLabel(m.starting_at))}`;
  else if (m.upcoming) status = esc(kickoffText(m.starting_at));
  else status = `${esc(deps.liveMinuteText(m))} · LIVE`;
  const score = finished || !m.upcoming ? `${m.home_score ?? 0} - ${m.away_score ?? 0}` : "vs";
  return `
    <div class="match-search-result-icon"><i class="fa-solid fa-shield-halved"></i></div>
    <div class="match-search-result-main">
      <div class="match-search-result-clubs ms-clubs">
        <span class="ms-team">${esc(m.home_team || "?")}</span>
        <span class="ms-score${finished ? " ms-score-ft" : ""}">${score}</span>
        <span class="ms-team">${esc(m.away_team || "?")}</span>
      </div>
      <div class="match-search-result-meta">${status}${m.league ? ` · ${esc(m.league)}` : ""}</div>
      ${finished ? goalsLine(m) : ""}
    </div>
    <i class="fa-solid fa-chevron-right"></i>`;
}

/* ------------------------------ render ----------------------------- */

function paint(results, list, query, scopeSel, deps, f = { country: "" }) {
  results.innerHTML = "";
  if (!list.length) {
    const where = scopeSel === "all" ? "live, upcoming or past 3 days" : scopeSel === "past" ? "the past 3 days" : scopeSel;
    results.innerHTML = `<div class="match-search-empty"><i class="fa-solid fa-magnifying-glass"></i>
      ${query ? `No ${esc(where)} match found for <strong>${esc(query)}</strong>.`
        : f.country ? `No ${esc(where)} matches for <strong>${esc(f.country)}</strong>.` : `No ${esc(where)} matches right now.`}</div>`;
    return;
  }
  for (const group of groupResults(list, scopeSel)) {
    if (group.label) {
      const h = document.createElement("div");
      h.className = "ms-group";
      h.textContent = group.label;
      results.appendChild(h);
    }
    for (const m of group.items) {
      results.appendChild(footballCardEl(m, { liveMinuteText: deps.liveMinuteText, onOpen: deps.openMatchRoom }));
    }
  }
}

// The existing filter bar (Country / league + Next 12h/34h/3d/7d) refines the chip lists.
function filterState() {
  const hoursEl = document.getElementById("matches-filter-hours");
  const countryEl = document.getElementById("matches-filter-country");
  return {
    hours: hoursEl ? Number(hoursEl.value) || 0 : 0,
    country: countryEl ? countryEl.value.trim() : "",
  };
}

function cacheKey(query, scopeSel, f) {
  return `${scopeSel}|${query}|${f.hours}|${f.country.toLowerCase()}`;
}

function readList(query, scopeSel, f) {
  const key = cacheKey(query, scopeSel, f);
  if (listCache.has(key)) return listCache.get(key);
  if (!query && !f.country) { // unfiltered lists survive an app restart, so a chip tap paints instantly
    try {
      const raw = JSON.parse(localStorage.getItem(`${PERSIST_PREFIX}${scopeSel}:${f.hours}`) || "null");
      if (raw && Array.isArray(raw.list) && Date.now() - (raw.t || 0) < 600000) { listCache.set(key, raw.list); return raw.list; }
    } catch (e) { /* ignore */ }
  }
  return null;
}

function writeList(query, scopeSel, f, list) {
  listCache.set(cacheKey(query, scopeSel, f), list);
  if (!query && !f.country) {
    try { localStorage.setItem(`${PERSIST_PREFIX}${scopeSel}:${f.hours}`, JSON.stringify({ t: Date.now(), list: list.slice(0, 60) })); } catch (e) { /* ignore */ }
  }
}

function syncScopeRow() {
  if (!scopeRow) return;
  scopeRow.querySelectorAll(".ms-scope").forEach((b) => b.classList.toggle("ms-scope-on", b.dataset.scope === scope));
}

async function run(input, results, deps) {
  clearTimeout(refreshTimer);
  const query = input.value.trim();
  const effective = scope || "all";
  // While a chip is active the original football list steps aside so the chip visibly filters.
  if (sports) sports.setResultsMode(!!scope);

  if (sports && sports.active()) {
    const mineSport = ++ticket;
    results.classList.remove("hidden");
    await sports.render({
      query, scope: effective, results,
      stillCurrent: () => mineSport === ticket,
      refresh: () => run(input, results, deps),
    });
    return;
  }

  if (!query && !scope) {
    ++ticket;
    results.classList.add("hidden");
    results.innerHTML = "";
    return;
  }

  const mine = ++ticket;
  results.classList.remove("hidden");
  const f = filterState();
  const cached = readList(query, effective, f);
  if (cached) paint(results, cached, query, effective, deps, f);
  else results.innerHTML = `<div class="match-search-loading"><i class="fa-solid fa-spinner fa-spin"></i> ${query ? "Searching clubs…" : "Loading matches…"}</div>`;

  try {
    const list = query
      ? await api.searchMatchesScoped(query, effective, DAYS, TZ)
      : await api.browseMatches(effective, DAYS, TZ, f.hours, f.country);
    if (mine !== ticket) return;
    if (!cached || JSON.stringify(cached) !== JSON.stringify(list)) paint(results, list, query, effective, deps, f);
    writeList(query, effective, f, list);
    if ((effective === "all" || effective === "live") && list.some((m) => m.scope === "live")) {
      const tick = () => {
        if (document.hidden) { refreshTimer = setTimeout(tick, REFRESH_MS); return; }
        run(input, results, deps);
      };
      refreshTimer = setTimeout(tick, REFRESH_MS);
    }
  } catch (e) {
    if (mine !== ticket) return;
    if (cached) return; // keep what is on screen if the refresh fails
    results.innerHTML = `<div class="match-data-error">${esc(e.message)} <button type="button" class="ms-retry">Retry</button></div>`;
    const rb = results.querySelector(".ms-retry");
    if (rb) rb.onclick = () => run(input, results, deps);
  }
}

/* -------------------------------- init ------------------------------ */

export function initScopedMatchSearch(deps) {
  const input = document.getElementById("matches-search-input");
  const button = document.getElementById("matches-search-btn");
  const results = document.getElementById("matches-search-results");
  if (!input || !button || !results || input._msBound) return;
  input._msBound = true;

  const row = document.createElement("div");
  row.className = "ms-scopes";
  row.innerHTML = SCOPES.map(([key, label]) =>
    `<button type="button" class="ms-scope" data-scope="${key}">${label}</button>`
  ).join("");
  results.parentNode.insertBefore(row, results);
  scopeRow = row;

  // Keep the filter bar (and the sport dropdown in it) above the results, so switching sport
  // never needs a scroll past a long list.
  const bar = results.parentNode.querySelector(".matches-filter-bar");
  if (bar && bar.parentNode === results.parentNode) results.parentNode.insertBefore(results, bar.nextSibling);

  sports = createSportsMore({ onChange: () => run(input, results, deps) });
  sports.attach(results.parentNode);

  row.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-scope]");
    if (!btn) return;
    // tap a chip to filter; tap the active chip again to clear the filter
    if (scope === btn.dataset.scope) return;   // a chip is always active
    scope = btn.dataset.scope;
    syncScopeRow();
    run(input, results, deps);
  });

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input, results, deps), 250);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      run(input, results, deps);
    }
  });
  button.addEventListener("click", () => run(input, results, deps));
  syncScopeRow();
  run(input, results, deps);
  const navBtn = document.querySelector('.nav-btn[data-tab="matches"]');
  if (navBtn) navBtn.addEventListener("click", () => run(input, results, deps));

  // Filter bar -> chip lists update as you change them (no Apply needed for the chips).
  const hoursEl = document.getElementById("matches-filter-hours");
  const countryEl = document.getElementById("matches-filter-country");
  const rerunChips = () => { if (scope && !input.value.trim() && !(sports && sports.active())) run(input, results, deps); };
  if (hoursEl) hoursEl.addEventListener("change", rerunChips);
  if (countryEl) {
    let ctimer;
    countryEl.addEventListener("input", () => { clearTimeout(ctimer); ctimer = setTimeout(rerunChips, 300); });
  }
}

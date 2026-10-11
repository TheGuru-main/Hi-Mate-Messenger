// LiveSports search v2: scope toggles (All / Live / Upcoming / Past 3d), past-matches feed,
// grouped results with scorers for finished games. Replaces the legacy input wiring.
import { api } from "./api.js";

const SCOPES = [
  ["all", "All"],
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["past", "Past 3d"],
];
const DAYS = 3;
const RECENT_KEY = "hm:recent-matches:v1";

let scope = "all";
let ticket = 0;
let recentCache = null;

const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
})();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ----------------------------- helpers ----------------------------- */

export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return "Earlier";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

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

/* ------------------------------ render ----------------------------- */

function paint(results, list, query, deps) {
  results.innerHTML = "";
  if (!list.length) {
    const where = scope === "all" ? "live, upcoming or past 3 days" : scope === "past" ? "the past 3 days" : scope;
    results.innerHTML = `<div class="match-search-empty"><i class="fa-solid fa-magnifying-glass"></i>
      ${query ? `No ${esc(where)} match found for <strong>${esc(query)}</strong>.` : `No finished matches in the past ${DAYS} days.`}</div>`;
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
      div.innerHTML = resultHtml(m, deps);
      div.onclick = () => deps.openMatchRoom(m);
      results.appendChild(div);
    }
  }
}

function readRecent() {
  if (recentCache) return recentCache;
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "null");
    if (raw && Array.isArray(raw.list)) { recentCache = raw.list; return recentCache; }
  } catch (e) { /* ignore */ }
  return null;
}

function writeRecent(list) {
  recentCache = list;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify({ t: Date.now(), list })); } catch (e) { /* ignore */ }
}

async function run(input, results, deps) {
  const query = input.value.trim();
  if (!query && scope !== "past") {
    results.classList.add("hidden");
    results.innerHTML = "";
    return;
  }
  const mine = ++ticket;
  results.classList.remove("hidden");

  // Past matches with no query: paint the cached list instantly, then refresh behind it.
  const cached = !query && scope === "past" ? readRecent() : null;
  if (cached) paint(results, cached, query, deps);
  else results.innerHTML = `<div class="match-search-loading"><i class="fa-solid fa-spinner fa-spin"></i> ${query ? "Searching clubs…" : "Loading recent matches…"}</div>`;

  try {
    const list = query
      ? await api.searchMatchesScoped(query, scope, DAYS, TZ)
      : await api.getRecentMatches(DAYS, TZ);
    if (mine !== ticket) return;
    if (!query) writeRecent(list);
    paint(results, list, query, deps);
  } catch (e) {
    if (mine !== ticket) return;
    if (cached) return; // keep the cached view if the refresh fails
    results.innerHTML = `<div class="match-data-error">${esc(e.message)}</div>`;
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
    `<button type="button" class="ms-scope${key === scope ? " ms-scope-on" : ""}" data-scope="${key}">${label}</button>`
  ).join("");
  results.parentNode.insertBefore(row, results);

  row.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-scope]");
    if (!btn) return;
    scope = btn.dataset.scope;
    row.querySelectorAll(".ms-scope").forEach((b) => b.classList.toggle("ms-scope-on", b.dataset.scope === scope));
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
}

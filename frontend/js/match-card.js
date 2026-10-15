// Shared LiveSports card: ONE markup + ONE style for every sector.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function dayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "Earlier";
  const sod = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((sod(new Date()) - sod(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

function kickoff(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "UPCOMING";
  return "Kickoff " + d.toLocaleString([], {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

function eventSummary(m) {
  const p = [];
  if (m.yellow_card_count) p.push(`<span class="match-event-pill yellow"><i class="fa-solid fa-square"></i> ${m.yellow_card_count}</span>`);
  if (m.red_card_count) p.push(`<span class="match-event-pill red"><i class="fa-solid fa-square"></i> ${m.red_card_count}</span>`);
  if (m.substitution_count) p.push(`<span class="match-event-pill sub"><i class="fa-solid fa-right-left"></i> ${m.substitution_count}</span>`);
  return p.length ? `<div class="match-event-summary">${p.join("")}</div>` : "";
}

function goalsLine(m) {
  const goals = m.goals || [];
  if (!goals.length) return "";
  const tag = (t) => (t === "penalty" ? " (pen)" : t === "own_goal" ? " (og)" : "");
  const fmt = (g) => `${esc(g.player)} ${esc(g.minute)}'${tag(g.type)}`;
  const side = (s) => goals.filter((g) => g.side === s).map(fmt).join(", ") || "–";
  return `<div class="ms-goals"><span>${side("home")}</span><span>${side("away")}</span></div>`;
}

function periodLine(m) {
  if (!m.periods || !m.periods.length) return "";
  if (m.sport === "cricket" && m.finished) return "";
  return `<div class="ms-periods">${m.periods.map((p) =>
    `<span>${esc(String(p.label).replace("Set ", "S"))} ${p.home ?? "–"}-${p.away ?? "–"}</span>`).join("")}</div>`;
}

function initials(name) {
  const words = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

function club(name, side, win, logo) {
  const img = logo
    ? `<img class="match-club-logo" src="${esc(logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<span class="match-club-name${win ? " ms-win" : ""}" data-side="${side}">
    <span class="match-club-badge-wrap"><span class="match-club-init">${esc(initials(name))}</span>${img}</span><span>${esc(name || "?")}</span></span>`;
}

export function buildCard(c, onOpen) {
  const el = document.createElement("div");
  el.className = `match-list-item ${c.state}`;
  el.innerHTML = `
    <div class="match-list-topline">
      <span class="match-state-pill ${c.state}">${esc(c.pill)}</span>
      ${c.room ? `<span class="match-room-pill"><i class="fa-solid fa-comments"></i> Room</span>` : ""}
    </div>
    <div class="match-clubs">
      <div class="match-club">${club(c.home, "home", c.homeWin, c.homeLogo)}</div>
      <div class="match-score-box"><strong>${esc(c.score)}</strong></div>
      <div class="match-club away">${club(c.away, "away", c.awayWin, c.awayLogo)}</div>
    </div>
    <div class="match-list-sub">${esc(c.meta)}</div>
    ${c.extra || ""}
    <div class="match-card-footer">
      <span><i class="fa-solid ${c.footIcon}"></i> ${esc(c.footer)}</span>
      <i class="fa-solid fa-chevron-right"></i>
    </div>`;
  el.onclick = onOpen;
  return el;
}

export function footballCardEl(m, { liveMinuteText, onOpen }) {
  const past = !!m.finished || m.scope === "past";
  const state = past ? "past" : m.upcoming ? "upcoming" : "live";
  let meta = state === "past" ? `FT · ${dayLabel(m.starting_at)}`
    : state === "upcoming" ? kickoff(m.starting_at)
    : `${liveMinuteText(m, m._fetched_at || Date.now())} · LIVE`;
  if (m.league) meta += ` · ${m.league}`;
  const el = buildCard({
    state,
    pill: state === "past" ? "FT" : state === "upcoming" ? "UPCOMING" : "LIVE",
    room: !!m.has_room,
    home: m.home_team, away: m.away_team,
    homeLogo: m.home_logo || m.home_team_logo || "", awayLogo: m.away_logo || m.away_team_logo || "",
    score: state === "upcoming" ? "VS" : `${m.home_score ?? 0} - ${m.away_score ?? 0}`,
    meta,
    extra: state === "past" ? goalsLine(m) : eventSummary(m),
    footIcon: "fa-comments",
    footer: state === "upcoming" ? "Join match room" : state === "live" ? "Open live room" : "Open match room",
  }, () => onOpen(m));
  el.dataset.fixtureId = String(m.fixture_id ?? "");
  el.__matchData = m;
  wireTeamTaps(el, m);
  return el;
}

export function sportCardEl(m, onOpen) {
  const state = m.upcoming ? "upcoming" : m.live ? "live" : "past";
  const score = state === "upcoming" ? "VS"
    : m.sport === "cricket" ? `${m.home_score_text || "–"} / ${m.away_score_text || "–"}`
    : `${m.home_score_text || "0"} - ${m.away_score_text || "0"}`;
  const status = state === "upcoming" ? kickoff(m.starting_at)
    : state === "live" ? `${m.status_text || "LIVE"} · LIVE${m.game_score ? ` · ${m.game_score}` : ""}`
    : `${m.status_text || "FT"}${m.starting_at ? ` · ${dayLabel(m.starting_at)}` : ""}`;
  const sub = [m.league, m.round || m.match_type].filter(Boolean).join(" · ");
  const el = buildCard({
    state,
    pill: state === "past" ? "FT" : state === "upcoming" ? "UPCOMING" : "LIVE",
    room: false,
    home: (m.home_team || "?") + (m.serving === "home" ? " 🎾" : ""),
    away: (m.away_team || "?") + (m.serving === "away" ? " 🎾" : ""),
    homeWin: m.winner === "home", awayWin: m.winner === "away",
    homeLogo: m.home_logo || m.home_team_logo || "", awayLogo: m.away_logo || m.away_team_logo || "",
    score,
    meta: sub ? `${status} · ${sub}` : status,
    extra: periodLine(m),
    footIcon: "fa-circle-info",
    footer: "View details",
  }, onOpen);
  el.dataset.fixtureId = String(m.fixture_id ?? "");
  el.__matchData = m;
  wireTeamTaps(el, m);
  return el;
}


function wireTeamTaps(el, m) {
  const sport = m.sport || "football";

  el.querySelectorAll(".match-club-name").forEach((node) => {
    const side = node.dataset.side;
    const key = m[side + "_team_key"];

    if (!key) return;

    const name = m[side + "_team"] || node.textContent.trim();
    const logo = m[side + "_logo"] || m[side + "_team_logo"] || "";

    node.classList.add("match-team-tap");

    if (sport === "football") {
      node.dataset.tid = String(key);
      node.dataset.name = name;
      node.dataset.logo = logo;
      node.dataset.sport = "football";
    }

    node.addEventListener("click", (e) => {
      e.stopPropagation();

      document.dispatchEvent(new CustomEvent("hm:team-tap", {
        detail: {
          teamKey: key,
          name,
          logo: logo || null,
          sport,
          fixtureId: m.fixture_id ?? null
        }
      }));
    });
  });
}

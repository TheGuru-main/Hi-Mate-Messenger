import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { onMessage } from "./socket.js";

let activeFixtureId = null;
let activeGroupId = null;

function renderMatchListItem(m) {
  const div = document.createElement("div");
  div.className = "list-item";
  div.innerHTML = `
    <div class="avatar">⚽</div>
    <div style="flex:1">
    <div class="name">${m.upcoming ? `${m.home_team || "?"} vs ${m.away_team || "?"}` : `${m.home_team || "?"} ${m.home_score ?? 0} - ${m.away_score ?? 0} ${m.away_team || "?"}`}</div>
    <div class="sub">${m.upcoming ? `Kickoff ${new Date(m.starting_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}${m.league ? " · " + m.league : ""}` : (m.minute ? m.minute + "'" : "LIVE")} ${m.has_room ? "· room active" : ""}</div>
    </div>
  `;
  div.onclick = () => openMatchRoom(m);
  return div;
}

export async function loadLiveMatches() {
  const list = document.getElementById("matches-list");
  const hoursEl = document.getElementById("matches-filter-hours");
  const countryEl = document.getElementById("matches-filter-country");
  const hours = hoursEl ? hoursEl.value : 34;
  const country = countryEl ? countryEl.value.trim() : "";

  list.innerHTML = `<div class="section-title">Loading…</div>`;
  let liveError = null;
  const [live, upcoming] = await Promise.all([
    api.getLiveMatches().catch((e) => { liveError = e.message; return []; }),
    api.getUpcomingMatches({ hours, country: country || undefined }).catch(() => []),
  ]);
  list.innerHTML = `<div class="section-title">🔴 Live now</div>`;
  if (liveError) list.insertAdjacentHTML("beforeend", `<div class="error-text">${liveError}</div>`);
  else if (!live.length) list.insertAdjacentHTML("beforeend", `<div class="sub" style="padding:6px 2px;">No live matches right now.</div>`);
  live.forEach((m) => list.appendChild(renderMatchListItem(m)));
  list.insertAdjacentHTML("beforeend", `<div class="section-title">📅 Upcoming (next ${hours}h)</div>`);
  if (!upcoming.length) list.insertAdjacentHTML("beforeend", `<div class="sub" style="padding:6px 2px;">No upcoming fixtures found for this filter.</div>`);
  upcoming.forEach((m) => list.appendChild(renderMatchListItem(m)));

  const applyBtn = document.getElementById("matches-filter-apply");
  if (applyBtn && !applyBtn.dataset.wired) {
    applyBtn.dataset.wired = "1";
    applyBtn.addEventListener("click", () => loadLiveMatches());
  }
}

function renderScoreboard(m) {
  const el = document.getElementById("match-scoreboard");
  el.innerHTML = `
    <div class="teams">${m.home_team || "?"} vs ${m.away_team || "?"}</div>
    <div class="score">${m.home_score ?? 0} - ${m.away_score ?? 0}</div>
    <div class="minute">${m.minute ? m.minute + "' " : ""}${m.state && !m.upcoming ? "· LIVE" : ""}</div>
  `;
}

function escapeStatsHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatStatsLabel(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\\b\\w/g, (char) => char.toUpperCase());
}

function renderStatsValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value !== "object") {
    return escapeStatsHtml(value);
  }

  if (Array.isArray(value)) {
    if (!value.length) return "—";

    return value.map((item, index) => {
      if (item && typeof item === "object") {
        return `
          <div class="match-stat-card">
            <div class="match-stat-card-title">Item ${index + 1}</div>
            ${renderStatsObject(item)}
          </div>
        `;
      }

      return `
        <div class="match-stat-line">
          <span>${escapeStatsHtml(item)}</span>
        </div>
      `;
    }).join("");
  }

  return renderStatsObject(value);
}

function renderStatsObject(obj) {
  return Object.entries(obj)
    .filter(([key, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      const label = formatStatsLabel(key);

      if (value && typeof value === "object") {
        return `
          <div class="match-stat-group">
            <div class="match-stat-group-title">${escapeStatsHtml(label)}</div>
            <div class="match-stat-group-body">
              ${renderStatsValue(value)}
            </div>
          </div>
        `;
      }

      return `
        <div class="match-stat-line">
          <span class="match-stat-label">${escapeStatsHtml(label)}</span>
          <strong class="match-stat-value">${escapeStatsHtml(value)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderMatchStats(stats) {
  if (!stats || typeof stats !== "object") {
    return `<div class="match-stats-empty">No statistics available.</div>`;
  }

  const preferred = [
    "event_statistics",
    "statistics",
    "event_home_team",
    "event_away_team",
    "event_status",
    "event_final_result",
    "event_halftime_result",
    "league_name",
  ];

  const ordered = {};
  for (const key of preferred) {
    if (key in stats) ordered[key] = stats[key];
  }

  for (const [key, value] of Object.entries(stats)) {
    if (!(key in ordered)) ordered[key] = value;
  }

  return `
    <div class="match-stats-grid">
      ${renderStatsObject(ordered)}
    </div>
  `;
}

async function loadStatsFold(fixtureId) {
  const body = document.getElementById("match-stats-body");

  body.innerHTML = `
    <div class="match-stats-loading">
      <span class="stats-loader-dot"></span>
      Loading match statistics…
    </div>
  `;

  try {
    const stats = await api.getMatchStats(fixtureId);
    body.innerHTML = renderMatchStats(stats);
  } catch (e) {
    body.innerHTML = `
      <div class="match-stats-error">
        <div class="match-stats-error-title">Statistics unavailable</div>
        <div>${escapeStatsHtml(e.message)}</div>
      </div>
    `;
  }
}

function renderMatchBubble(content, isMine) {
  const row = document.createElement("div");
  row.className = `bubble-row ${isMine ? "mine" : "theirs"}`;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${isMine ? "mine" : "theirs"}`;
  bubble.textContent = content;
  row.appendChild(bubble);
  return row;
}

export async function openMatchRoom(match) {
  activeFixtureId = match.fixture_id;
  document.getElementById("match-room-title").textContent = match.name || "Match";
  renderScoreboard(match);
  showPage("match-room");

  document.getElementById("match-chat-messages").innerHTML = "";

  try {
    const res = await api.joinMatch(match.fixture_id);
    activeGroupId = res.group_id;
    const messages = await api.getMessages(activeGroupId);
    const me = getCachedUser();
    const container = document.getElementById("match-chat-messages");
    messages.reverse().forEach((m) => {
      container.appendChild(renderMatchBubble(m.content || "", m.sender_uid === me?.uid));
    });
  } catch (e) {
    console.error(e);
  }

  loadStatsFold(match.fixture_id);
}

export function initMatches() {
  document.getElementById("btn-back-from-match").onclick = () => {
    activeFixtureId = null;
    activeGroupId = null;
    showPage("home");
  };

  document.getElementById("toggle-stats-fold").onclick = () => {
    document.getElementById("match-stats-body").classList.toggle("hidden");
  };

  document.getElementById("btn-send-match-message").onclick = sendMatchMessage;
  document.getElementById("match-chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMatchMessage();
  });

  // Live goal events + banter messages
  onMessage((data) => {
    if (data.type === "match_event" && data.event === "goal" && data.fixture_id === activeFixtureId) {
      const container = document.getElementById("match-chat-messages");
      const goalDiv = document.createElement("div");
      goalDiv.style.textAlign = "center";
      goalDiv.style.fontSize = "13px";
      goalDiv.style.color = "#FFB454";
      goalDiv.style.margin = "8px 0";
      goalDiv.textContent = `⚽ GOAL! ${data.team} ${data.score} (${data.minute}')`;
      container.appendChild(goalDiv);
      container.scrollTop = container.scrollHeight;
      // refresh the scoreboard too
      loadLiveMatches();
      return;
    }
    if (data.type === "message" && data.group_id === activeGroupId) {
      const me = getCachedUser();
      const container = document.getElementById("match-chat-messages");
      container.appendChild(renderMatchBubble(data.content || "", data.sender_uid === me?.uid));
      container.scrollTop = container.scrollHeight;
    }
  });
}

async function sendMatchMessage() {
  const input = document.getElementById("match-chat-input");
  const content = input.value.trim();
  if (!content || !activeGroupId) return;
  input.value = "";

  const container = document.getElementById("match-chat-messages");
  container.appendChild(renderMatchBubble(content, true));
  container.scrollTop = container.scrollHeight;

  try {
    await api.sendMessage({ group_id: activeGroupId, type: "text", content });
  } catch (e) {
    alert(e.message);
  }
}

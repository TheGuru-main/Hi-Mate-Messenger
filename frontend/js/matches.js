import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { onMessage } from "./socket.js";

let activeFixtureId = null;
let activeGroupId = null;

let matchesRefreshTimer = null;
let matchRoomRefreshTimer = null;
let matchClockTimer = null;

let activeMatchSnapshot = null;
let activeMatchFetchedAt = 0;


/* ============================================================
   SAFE HTML
   ============================================================ */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* ============================================================
   LIVE MINUTE
   ============================================================ */

function liveMinuteText(match, fetchedAt = Date.now()) {
  if (!match || match.upcoming) {
    return "";
  }

  const raw = String(match.minute ?? match.state ?? "").trim();

  if (!raw) {
    return "LIVE";
  }

  const numeric = raw.match(/^(\d+)$/);

  if (!numeric) {
    return raw;
  }

  const baseMinute = Number(numeric[1]);

  if (!Number.isFinite(baseMinute)) {
    return raw;
  }

  const elapsedMinutes = Math.floor(
    Math.max(0, Date.now() - fetchedAt) / 60000
  );

  return `${Math.min(baseMinute + elapsedMinutes, 120)}'`;
}


/* ============================================================
   MATCH LIST
   ============================================================ */

function renderMatchListItem(m) {
  const div = document.createElement("div");
  div.className = "match-list-item";

  const fetchedAt = m._fetched_at || Date.now();

  const title = m.upcoming
    ? `${m.home_team || "?"} vs ${m.away_team || "?"}`
    : `${m.home_team || "?"} ${m.home_score ?? 0} - ${m.away_score ?? 0} ${m.away_team || "?"}`;

  let sub;

  if (m.upcoming) {
    const kickoff = new Date(m.starting_at);

    sub =
      `Kickoff ${kickoff.toLocaleString([], {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      })}` +
      (m.league ? ` · ${m.league}` : "");
  } else {
    sub =
      `${liveMinuteText(m, fetchedAt)} · LIVE` +
      (m.league ? ` · ${m.league}` : "");
  }

  div.innerHTML = `
    <div class="match-list-icon">⚽</div>

    <div class="match-list-main">
      <div class="match-list-title">${escapeHtml(title)}</div>
      <div class="match-list-sub">${escapeHtml(sub)}</div>
    </div>

    <div class="match-list-arrow">›</div>
  `;

  div.onclick = () => openMatchRoom(m);

  return div;
}


/* ============================================================
   LIVE / UPCOMING LIST
   ============================================================ */

export async function loadLiveMatches() {
  const list = document.getElementById("matches-list");

  if (!list) return;

  const hoursEl = document.getElementById("matches-filter-hours");
  const countryEl = document.getElementById("matches-filter-country");

  const hours = hoursEl ? hoursEl.value : "34";
  const country = countryEl ? countryEl.value.trim() : "";

  let liveError = null;
  let upcomingError = null;

  const [live, upcoming] = await Promise.all([
    api.getLiveMatches().catch((e) => {
      liveError = e.message;
      return [];
    }),

    api.getUpcomingMatches({
      hours,
      ...(country ? { country } : {})
    }).catch((e) => {
      upcomingError = e.message;
      return [];
    })
  ]);

  const now = Date.now();

  live.forEach((m) => {
    m._fetched_at = now;
  });

  list.innerHTML = "";

  const liveTitle = document.createElement("div");
  liveTitle.className = "section-title";
  liveTitle.textContent = "🔴 Live now";
  list.appendChild(liveTitle);

  if (liveError) {
    const error = document.createElement("div");
    error.className = "match-data-error";
    error.textContent = `Live scores unavailable: ${liveError}`;
    list.appendChild(error);
  } else if (!live.length) {
    const empty = document.createElement("div");
    empty.className = "match-empty";
    empty.textContent = "No live matches right now.";
    list.appendChild(empty);
  } else {
    live.forEach((m) => {
      list.appendChild(renderMatchListItem(m));
    });
  }

  const upcomingTitle = document.createElement("div");
  upcomingTitle.className = "section-title";
  upcomingTitle.textContent = `📅 Upcoming · next ${hours}h`;
  list.appendChild(upcomingTitle);

  if (upcomingError) {
    const error = document.createElement("div");
    error.className = "match-data-error";
    error.textContent = `Upcoming fixtures unavailable: ${upcomingError}`;
    list.appendChild(error);
  } else if (!upcoming.length) {
    const empty = document.createElement("div");
    empty.className = "match-empty";
    empty.textContent = "No upcoming fixtures found for this filter.";
    list.appendChild(empty);
  } else {
    upcoming.forEach((m) => {
      list.appendChild(renderMatchListItem(m));
    });
  }

  const applyBtn = document.getElementById("matches-filter-apply");

  if (applyBtn && !applyBtn.dataset.wired) {
    applyBtn.dataset.wired = "1";
    applyBtn.addEventListener("click", () => loadLiveMatches());
  }
}


/* ============================================================
   REALTIME MATCH LIST REFRESH
   ============================================================ */

function startMatchesPolling() {
  if (matchesRefreshTimer) {
    clearInterval(matchesRefreshTimer);
  }

  matchesRefreshTimer = setInterval(() => {
    const tab = document.getElementById("tab-matches");

    if (!tab || tab.classList.contains("hidden")) {
      return;
    }

    loadLiveMatches();
  }, 15000);
}


/* ============================================================
   SCOREBOARD
   ============================================================ */

function renderScoreboard(m) {
  const el = document.getElementById("match-scoreboard");

  if (!el || !m) return;

  activeMatchSnapshot = m;

  const fetchedAt = activeMatchFetchedAt || Date.now();

  const minute = m.upcoming
    ? "UPCOMING"
    : liveMinuteText(m, fetchedAt);

  const state = m.upcoming
    ? `Kickoff ${new Date(m.starting_at).toLocaleString([], {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      })}`
    : `${minute} · LIVE`;

  el.innerHTML = `
    <div class="match-scoreboard-teams">
      <span>${escapeHtml(m.home_team || "?")}</span>
      <strong>VS</strong>
      <span>${escapeHtml(m.away_team || "?")}</span>
    </div>

    <div class="match-scoreboard-score">
      ${m.home_score ?? 0}
      <span>-</span>
      ${m.away_score ?? 0}
    </div>

    <div class="match-scoreboard-state">
      ${escapeHtml(state)}
    </div>
  `;
}


/* ============================================================
   STATS NORMALIZATION
   ============================================================ */

function parseJsonLike(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return value;
    }
  }

  return value;
}


function formatStatsLabel(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


function renderStatsTable(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return `<div class="match-stats-empty">No detailed statistics available.</div>`;
  }

  const validRows = rows
    .map((row) => parseJsonLike(row))
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row)
    );

  if (!validRows.length) {
    return `<div class="match-stats-empty">No detailed statistics available.</div>`;
  }

  return `
    <div class="match-stat-table">
      <div class="match-stat-table-head">
        <span>Statistic</span>
        <span>HOME</span>
        <span>AWAY</span>
      </div>

      ${validRows.map((row) => `
        <div class="match-stat-table-row">
          <span class="match-stat-type">
            ${escapeHtml(
              row.type ||
              row.name ||
              row.statistic ||
              "Statistic"
            )}
          </span>

          <strong>${escapeHtml(row.home ?? "—")}</strong>
          <strong>${escapeHtml(row.away ?? "—")}</strong>
        </div>
      `).join("")}
    </div>
  `;
}


function renderStatsObject(obj, depth = 0) {
  const parsed = parseJsonLike(obj);

  if (
    parsed === null ||
    parsed === undefined ||
    parsed === ""
  ) {
    return "";
  }

  if (Array.isArray(parsed)) {
    const looksLikeStatistics = parsed.some(
      (item) =>
        item &&
        typeof item === "object" &&
        ("type" in item || "home" in item || "away" in item)
    );

    if (looksLikeStatistics) {
      return renderStatsTable(parsed);
    }

    return parsed
      .map((item, index) => `
        <div class="match-stat-card">
          <div class="match-stat-card-title">Item ${index + 1}</div>
          ${renderStatsObject(item, depth + 1)}
        </div>
      `)
      .join("");
  }

  if (typeof parsed !== "object") {
    return `
      <div class="match-stat-line">
        <span class="match-stat-value">${escapeHtml(parsed)}</span>
      </div>
    `;
  }

  return Object.entries(parsed)
    .filter(
      ([key, value]) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
    .map(([key, value]) => {
      const normalized = parseJsonLike(value);

      if (
        normalized &&
        typeof normalized === "object"
      ) {
        return `
          <div class="match-stat-group">
            <div class="match-stat-group-title">
              ${escapeHtml(formatStatsLabel(key))}
            </div>

            <div class="match-stat-group-body">
              ${renderStatsObject(normalized, depth + 1)}
            </div>
          </div>
        `;
      }

      return `
        <div class="match-stat-line">
          <span class="match-stat-label">
            ${escapeHtml(formatStatsLabel(key))}
          </span>

          <strong class="match-stat-value">
            ${escapeHtml(normalized)}
          </strong>
        </div>
      `;
    })
    .join("");
}


function renderMatchStats(stats) {
  const parsed = parseJsonLike(stats);

  if (!parsed || typeof parsed !== "object") {
    return `<div class="match-stats-empty">No statistics available.</div>`;
  }

  let html = "";

  // AllSportsAPI's actual football response uses this array.
  if (Array.isArray(parsed.statistics)) {
    html += `
      <div class="match-stat-section">
        <div class="match-stat-section-title">
          Match Statistics
        </div>

        ${renderStatsTable(parsed.statistics)}
      </div>
    `;
  }

  const info = {};

  const infoKeys = [
    "event_home_team",
    "event_away_team",
    "event_status",
    "event_final_result",
    "event_halftime_result",
    "league_name",
    "country_name",
    "event_stadium",
    "event_referee"
  ];

  for (const key of infoKeys) {
    if (
      parsed[key] !== undefined &&
      parsed[key] !== null &&
      parsed[key] !== ""
    ) {
      info[key] = parsed[key];
    }
  }

  if (Object.keys(info).length) {
    html += `
      <div class="match-stat-section">
        <div class="match-stat-section-title">
          Match Information
        </div>

        ${renderStatsObject(info)}
      </div>
    `;
  }

  if (!html) {
    html = `
      <div class="match-stat-section">
        ${renderStatsObject(parsed)}
      </div>
    `;
  }

  return html;
}


/* ============================================================
   STATS FOLD
   ============================================================ */

async function loadStatsFold(fixtureId) {
  const body = document.getElementById("match-stats-body");

  if (!body) return;

  body.innerHTML = `
    <div class="match-stats-loading">
      <span class="stats-loader-dot"></span>
      Loading statistics…
    </div>
  `;

  try {
    const stats = await api.getMatchStats(fixtureId);

    body.innerHTML = renderMatchStats(stats);
  } catch (e) {
    body.innerHTML = `
      <div class="match-stats-error">
        <div class="match-stats-error-title">
          Statistics unavailable
        </div>
        <div>${escapeHtml(e.message)}</div>
      </div>
    `;
  }
}


/* ============================================================
   MATCH CHAT BUBBLES
   ============================================================ */

function renderMatchBubble(content, isMine) {
  const row = document.createElement("div");

  row.className =
    `match-bubble-row ${isMine ? "mine" : "theirs"}`;

  const bubble = document.createElement("div");

  bubble.className =
    `match-bubble ${isMine ? "mine" : "theirs"}`;

  bubble.textContent = content || "";

  row.appendChild(bubble);

  return row;
}


/* ============================================================
   MATCH ROOM REFRESH
   ============================================================ */

async function refreshActiveMatch() {
  if (!activeFixtureId) return;

  try {
    const [live, upcoming] = await Promise.all([
      api.getLiveMatches().catch(() => []),
      api.getUpcomingMatches({ hours: 2 }).catch(() => [])
    ]);

    const all = [...live, ...upcoming];

    const match = all.find(
      (item) =>
        String(item.fixture_id) === String(activeFixtureId)
    );

    if (!match) {
      // It has most likely finished or left the live feed.
      // Keep the room open, but stop pretending it is live.
      if (activeMatchSnapshot && !activeMatchSnapshot.upcoming) {
        activeMatchSnapshot = {
          ...activeMatchSnapshot,
          state: "Finished",
          minute: "FT"
        };

        renderScoreboard(activeMatchSnapshot);
      }

      return;
    }

    activeMatchSnapshot = match;
    activeMatchFetchedAt = Date.now();

    renderScoreboard(match);

    // Keep the fold fresh while the room is open.
    const statsBody = document.getElementById("match-stats-body");

    if (statsBody && !statsBody.classList.contains("hidden")) {loadStatsFold(activeFixtureId);
    }

  } catch (e) {
    console.error("Match refresh failed:", e);
  }
}


function startMatchRoomPolling() {
  stopMatchRoomPolling();

  matchRoomRefreshTimer = setInterval(
    refreshActiveMatch,
    15000
  );

  matchClockTimer = setInterval(() => {
    if (activeMatchSnapshot) {
      renderScoreboard(activeMatchSnapshot);
    }
  }, 1000);
}


function stopMatchRoomPolling() {
  if (matchRoomRefreshTimer) {
    clearInterval(matchRoomRefreshTimer);
    matchRoomRefreshTimer = null;
  }

  if (matchClockTimer) {
    clearInterval(matchClockTimer);
    matchClockTimer = null;
  }
}


/* ============================================================
   OPEN MATCH ROOM
   ============================================================ */

export async function openMatchRoom(match) {
  activeFixtureId = match.fixture_id;

  activeMatchSnapshot = match;
  activeMatchFetchedAt = Date.now();

  const title = document.getElementById("match-room-title");

  if (title) {
    title.textContent =
      match.name ||
      `${match.home_team || "?"} vs ${match.away_team || "?"}`;
  }

  renderScoreboard(match);
  showPage("match-room");

  const container =
    document.getElementById("match-chat-messages");

  if (container) {
    container.innerHTML = "";
  }

  try {
    const res = await api.joinMatch(match.fixture_id);

    activeGroupId = res.group_id;

    const messages =
      await api.getMessages(activeGroupId);

    const me = getCachedUser();

    const chatMessages =
      document.getElementById("match-chat-messages");

    if (chatMessages) {
      messages.reverse().forEach((m) => {
        chatMessages.appendChild(
          renderMatchBubble(
            m.content || "",
            m.sender_uid === me?.uid
          )
        );
      });

      chatMessages.scrollTop =
        chatMessages.scrollHeight;
    }

  } catch (e) {
    console.error("Match room load failed:", e);
  }

  loadStatsFold(match.fixture_id);
  startMatchRoomPolling();
}


/* ============================================================
   INIT
   ============================================================ */

export function initMatches() {
  const back =
    document.getElementById("btn-back-from-match");

  if (back) {
    back.onclick = () => {
      stopMatchRoomPolling();

      activeFixtureId = null;
      activeGroupId = null;
      activeMatchSnapshot = null;

      showPage("home");
    };
  }

  const fold =
    document.getElementById("toggle-stats-fold");

  if (fold) {
    fold.onclick = () => {
      const body =
        document.getElementById("match-stats-body");

      if (!body) return;

      body.classList.toggle("hidden");

      if (!body.classList.contains("hidden")) {
        loadStatsFold(activeFixtureId);
      }
    };
  }

  const send =
    document.getElementById("btn-send-match-message");

  if (send) {
    send.onclick = sendMatchMessage;
  }

  const input =
    document.getElementById("match-chat-input");

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendMatchMessage();
      }
    });
  }

  // Refresh the LiveSports tab continuously.
  startMatchesPolling();

  onMessage((data) => {
    if (
      data.type === "match_event" &&
      data.event === "goal" &&
      String(data.fixture_id) === String(activeFixtureId)
    ) {
      const container =
        document.getElementById("match-chat-messages");

      if (container) {
        const goalDiv =
          document.createElement("div");

        goalDiv.className = "match-goal-event";

        goalDiv.textContent =
          `⚽ GOAL! ${data.team} ${data.score} (${data.minute}')`;

        container.appendChild(goalDiv);
        container.scrollTop =
          container.scrollHeight;
      }

      refreshActiveMatch();
      return;
    }

    if (
      data.type === "message" &&
      String(data.group_id) === String(activeGroupId)
    ) {
      const me = getCachedUser();

      const container =
        document.getElementById("match-chat-messages");

      if (!container) return;

      container.appendChild(
        renderMatchBubble(
          data.content || "",
          data.sender_uid === me?.uid
        )
      );

      container.scrollTop =
        container.scrollHeight;
    }
  });
}


async function sendMatchMessage() {
  const input =
    document.getElementById("match-chat-input");

  if (!input || !activeGroupId) return;

  const content = input.value.trim();

  if (!content) return;

  input.value = "";

  const container =
    document.getElementById("match-chat-messages");

  if (container) {
    container.appendChild(
      renderMatchBubble(content, true)
    );

    container.scrollTop =
      container.scrollHeight;
  }

  try {
    await api.sendMessage({
      group_id: activeGroupId,
      type: "text",
      content
    });
  } catch (e) {
    alert(e.message);
  }
}

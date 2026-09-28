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
  list.innerHTML = `<div class="section-title">Loading…</div>`;
  let liveError = null;
  const [live, upcoming] = await Promise.all([
    api.getLiveMatches().catch((e) => { liveError = e.message; return []; }),
    api.getUpcomingMatches().catch(() => []),
  ]);
  list.innerHTML = `<div class="section-title">🔴 Live now</div>`;
  if (liveError) list.insertAdjacentHTML("beforeend", `<div class="error-text">${liveError}</div>`);
  else if (!live.length) list.insertAdjacentHTML("beforeend", `<div class="sub" style="padding:6px 2px;">No live matches right now.</div>`);
  live.forEach((m) => list.appendChild(renderMatchListItem(m)));
  list.insertAdjacentHTML("beforeend", `<div class="section-title">📅 Upcoming</div>`);
  if (!upcoming.length) list.insertAdjacentHTML("beforeend", `<div class="sub" style="padding:6px 2px;">No upcoming fixtures found.</div>`);
  upcoming.forEach((m) => list.appendChild(renderMatchListItem(m)));
}

function renderScoreboard(m) {
  const el = document.getElementById("match-scoreboard");
  el.innerHTML = `
    <div class="teams">${m.home_team || "?"} vs ${m.away_team || "?"}</div>
    <div class="score">${m.home_score ?? 0} - ${m.away_score ?? 0}</div>
    <div class="minute">${m.minute ? m.minute + "' " : ""}${m.state && !m.upcoming ? "· LIVE" : ""}</div>
  `;
}

async function loadStatsFold(fixtureId) {
  const body = document.getElementById("match-stats-body");
  try {
    const stats = await api.getMatchStats(fixtureId);
    body.innerHTML = `<pre style="white-space:pre-wrap; font-size:11.5px;">${JSON.stringify(stats, null, 2)}</pre>`;
  } catch (e) {
    body.innerHTML = `<div class="error-text">Stats unavailable: ${e.message}</div>`;
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

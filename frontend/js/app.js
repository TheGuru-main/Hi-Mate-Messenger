import { getToken, getCachedUser, api, setCachedUser } from "./api.js";
import { showPage, showTab } from "./router.js";
import { initAuth } from "./auth.js";
import { initFeed, loadFeed, loadVideoFeed } from "./feed.js";
import { initSearch } from "./search.js";
import { initChat, loadKliqueList } from "./chat.js";
import { initMatches, loadLiveMatches } from "./matches.js";
import { initSettings } from "./settings.js";
import { connectMessageSocket } from "./socket.js";
import { initCategories } from "./categories.js";
import { initStatus, loadStatusFeed } from "./status.js";
import { initProfile } from "./profile.js";
import { initNotifications } from "./notifications.js";
import { initEdu } from "./edu.js";
import { initCalls } from "./calls.js";
import { attachWavyBubble } from "./wavy-bubble.js";
import { startLiveTimestamps } from "./media-utils.js";
import { initConversations, loadConversations } from "./conversations.js";

function initGoLiveButton() {
  const btn = document.getElementById("btn-go-live");
  if (!btn) return;
  btn.addEventListener("click", () => {
    showTab("live-video");
    alert("Going live is coming soon — this will open your camera and start broadcasting to viewers in this tab.");
  });
}

function initGigButton() {
  const btn = document.getElementById("btn-open-gig");
  if (!btn) return;
  btn.addEventListener("click", () => {
    alert("Gigs — coming soon: post or seek a gig in your country, community, or globally.");
  });
}

function initBottomNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === "feed") loadFeed();
      if (tab === "matches") loadLiveMatches();
      if (tab === "videos") loadVideoFeed();
      if (tab === "chats") { loadKliqueList(); loadStatusFeed(); loadConversations(); }
    };
  });
}

async function enterApp() {
  showPage("home");
  showTab("feed");
  connectMessageSocket();
  loadFeed();
  loadStatusFeed();

  // Refresh cached user in case something changed server-side
  try {
    const me = await api.getMe();
    setCachedUser(me);
  } catch (e) {
    // token likely expired — bounce back to login
    if (String(e.message).toLowerCase().includes("token") || String(e.message).includes("401")) {
      localStorage.removeItem("himate_token");
      showPage("auth-phone");
    }
  }
}

function boot() {
  initAuth();
  initFeed();
  initSearch();
  initChat();
  initMatches();
  initSettings();
  initCategories();
  initStatus();
  initGigButton();
  initGoLiveButton();
  initProfile();
  initNotifications();
  initEdu();
  initCalls();
  initConversations();
  initBottomNav();

  window.addEventListener("himate:authed", enterApp);

  // Instant-reopen behavior: if we already have a token cached, skip
  // straight past splash/auth into the app — this is the legitimate
  // "local storage keeps the session alive" use case.
  const token = getToken();
  if (token) {
    enterApp();
  } else {
    setTimeout(() => showPage("auth-phone"), 900); // brief splash, then to auth
  }
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    boot();
    startLiveTimestamps();
    const splashHeader = document.querySelector("#splash .glass-header");
    if (splashHeader) attachWavyBubble(splashHeader, { baseRadius: 90, waveAmplitude: 14 });
    const homeBrand = document.querySelector("#home .top-bar .brand");
    if (homeBrand) attachWavyBubble(homeBrand, { baseRadius: 40, waveAmplitude: 8, numPoints: 8 });
  } catch (e) {
    alert("STARTUP CRASH:\n" + e.message + "\n\n" + (e.stack || ""));
  }
});

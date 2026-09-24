import { getToken, getCachedUser, api, setCachedUser } from "./api.js";
import { showPage, showTab } from "./router.js";
import { initAuth } from "./auth.js";
import { initFeed, loadFeed } from "./feed.js";
import { initSearch } from "./search.js";
import { initChat, loadKliqueList } from "./chat.js";
import { initMatches, loadLiveMatches } from "./matches.js";
import { initSettings } from "./settings.js";
import { connectMessageSocket } from "./socket.js";
import { initCategories } from "./categories.js";
import { initStatus, loadStatusFeed } from "./status.js";

function initBottomNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === "feed") loadFeed();
      if (tab === "matches") loadLiveMatches();
      if (tab === "chats") loadKliqueList();
    };
  });
}

async function enterApp() {
  showPage("home");
  showTab("feed");
  connectMessageSocket();
  loadFeed();

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

document.addEventListener("DOMContentLoaded", boot);

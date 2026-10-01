const PAGE_IDS = [
  "splash", "auth-phone", "auth-login", "auth-otp",
  "home", "chat-room", "match-room", "call-room", "settings", "profile-page", "edu-page",
];

export function showPage(id) {
  PAGE_IDS.forEach((pid) => {
    document.getElementById(pid).classList.toggle("hidden", pid !== id);
  });
  window.scrollTo(0, 0);
}

export function showTab(tab) {
  ["feed", "search", "matches", "chats", "live-video", "videos"].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

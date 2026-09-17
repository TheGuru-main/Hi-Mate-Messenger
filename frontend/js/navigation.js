// ==========================================
// HI-MATE MESSENGER
// navigation.js — page + tab switching
// ==========================================

function goToPage(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.add("hidden");
    });
    const target = document.getElementById(pageId);
    if (target) {
        target.classList.remove("hidden");
    }
    window.scrollTo(0, 0);
}

function goToTab(tab) {
    ["feed", "search", "matches", "chats"].forEach(t => {
        const el = document.getElementById("tab-" + t);
        if (el) el.classList.toggle("hidden", t !== tab);
    });
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    if (tab === "feed" && typeof loadFeed === "function") loadFeed();
    if (tab === "matches" && typeof loadLiveMatches === "function") loadLiveMatches();
    if (tab === "chats" && typeof loadKliqueList === "function") loadKliqueList();
}

function initBottomNav() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", () => goToTab(btn.dataset.tab));
    });
}

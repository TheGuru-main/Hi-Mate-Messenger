// ==========================================
// HI-MATE MESSENGER
// app.js — boot sequence
// ==========================================

async function enterApp() {
    goToPage("home");
    goToTab("feed");
    connectMessageSocket();
    connectCallSocket();
    loadFeed();

    try {
        const me = await HiMateAPI.getMe();
        setCachedUser(me);
    } catch (e) {
        if (String(e.message).toLowerCase().includes("token") || String(e.message).includes("401")) {
            clearToken();
            goToPage("auth");
        }
    }
}

window.addEventListener("load", () => {
    initBottomNav();

    setTimeout(() => {
        const token = getToken();
        if (token) {
            enterApp();
        } else {
            goToPage("auth");
        }
    }, 1800); // brief splash before routing
});

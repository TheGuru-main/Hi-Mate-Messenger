import { api } from "./api.js";

export function buildConnectRow({ uid, kliqueStatus, isFollowing, messageLabel, onMessage }) {
    const row = document.createElement("div");
    row.className = "card-connect-row";
    let kStatus = kliqueStatus || null;
    let following = !!isFollowing;

    if (onMessage) {
        const msgBtn = document.createElement("button");
        msgBtn.className = "secondary-btn card-connect-btn";
        msgBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> ${messageLabel || "Message"}`;
        msgBtn.addEventListener("click", onMessage);
        row.appendChild(msgBtn);
    }

    const kliqueBtn = document.createElement("button");
    kliqueBtn.className = "secondary-btn card-connect-btn";
    const followBtn = document.createElement("button");
    followBtn.className = "secondary-btn card-connect-btn";
    row.appendChild(kliqueBtn);
    row.appendChild(followBtn);

    function paint() {
        const label = kStatus === "accepted" ? "Klique ✓" : kStatus === "pending" ? "Requested" : "Klique";
        kliqueBtn.innerHTML = `<i class="fa-solid fa-handshake"></i> ${label}`;
        kliqueBtn.classList.toggle("on", kStatus === "accepted" || kStatus === "pending");
        followBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> ${following ? "Following ✓" : "Follow"}`;
        followBtn.classList.toggle("on", following);
    }

    kliqueBtn.addEventListener("click", async () => {
        try {
            if (!kStatus || kStatus === "declined") {
                await api.kliqueRequest(uid);
                kStatus = "pending";
            } else if (kStatus === "pending") {
                await api.removeKlique(uid);
                kStatus = null;
            } else {
                if (!confirm("Remove this Klique connection?")) return;
                await api.removeKlique(uid);
                kStatus = null;
            }
            paint();
        } catch (e) { alert(e.message); }
    });

    followBtn.addEventListener("click", async () => {
        try {
            if (following) { await api.unfollowUser(uid); following = false; }
            else { await api.followUser(uid); following = true; }
            paint();
        } catch (e) { alert(e.message); }
    });

    paint();
    return row;
}

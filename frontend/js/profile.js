import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { openChat } from "./chat.js";
import { talentLabel, businessLabel } from "./categories.js";
import { timeAgo } from "./media-utils.js";

let currentProfileUid = null;
let currentTab = "posts";

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}


function renderPostCard(post) {
    const div = document.createElement("div");
    div.className = "card profile-post-card";
    const media = (post.media_refs && post.media_refs[0]) || null;
    div.innerHTML = `
      ${media ? `<img src="${media}" class="profile-post-thumb">` : ""}
      ${post.content ? `<div class="content">${escapeHtml(post.content)}</div>` : ""}
      <div class="post-meta">${post.category} · ${timeAgo(post.created_at)}</div>
    `;
    return div;
}

async function loadTab(uid, tab) {
    const grid = document.getElementById("profile-post-grid");
    grid.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        let posts = [];
        if (tab === "posts") posts = await api.getUserPosts(uid);
        else if (tab === "liked") posts = await api.getUserLikedPosts(uid);
        else if (tab === "shared") posts = await api.getUserSharedPosts(uid);

        grid.innerHTML = "";
        if (!posts.length) {
            grid.innerHTML = `<div class="section-title">Nothing here yet.</div>`;
            return;
        }
        posts.forEach(p => grid.appendChild(renderPostCard(p)));
    } catch (e) {
        grid.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function renderActions(profile) {
    const box = document.getElementById("profile-actions");
    if (profile.is_me) {
        box.innerHTML = "";
        return;
    }

    const kliqueLabel = profile.klique_status === "accepted" ? "Klique ✓"
        : profile.klique_status === "pending" ? "Requested"
        : "Request Klique";
    const kliqueDisabled = profile.klique_status ? "disabled" : "";

    const followLabel = profile.is_following ? "Following ✓" : "Follow";
    const followDisabled = profile.is_following ? "disabled" : "";

    box.innerHTML = `
      <button class="secondary-btn profile-action-btn" id="profile-klique-btn" ${kliqueDisabled}><i class="fa-solid fa-handshake"></i> ${kliqueLabel}</button>
      <button class="secondary-btn profile-action-btn" id="profile-follow-btn" ${followDisabled}><i class="fa-solid fa-user-plus"></i> ${followLabel}</button>
      <button class="primary-btn profile-action-btn" id="profile-message-btn"><i class="fa-solid fa-paper-plane"></i> Send Message</button>
    `;

    const kliqueBtn = box.querySelector("#profile-klique-btn");
    if (kliqueBtn && !profile.klique_status) {
        kliqueBtn.addEventListener("click", async () => {
            try {
                await api.kliqueRequest(profile.uid);
                kliqueBtn.textContent = "Requested";
                kliqueBtn.disabled = true;
            } catch (e) { alert(e.message); }
        });
    }

    const followBtn = box.querySelector("#profile-follow-btn");
    if (followBtn && !profile.is_following) {
        followBtn.addEventListener("click", async () => {
            try {
                await api.followUser(profile.uid);
                followBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Following ✓';
                followBtn.disabled = true;
            } catch (e) { alert(e.message); }
        });
    }

    box.querySelector("#profile-message-btn").addEventListener("click", () => {
        openChat(profile.uid, profile.username);
    });
}

export async function openProfile(uid) {
    currentProfileUid = uid;
    currentTab = "posts";
    showPage("profile-page");

    document.getElementById("profile-username").textContent = "Loading…";
    document.getElementById("profile-badges").innerHTML = "";
    document.getElementById("profile-meta").textContent = "";
    document.getElementById("profile-joined").textContent = "";
    document.getElementById("profile-actions").innerHTML = "";
    document.getElementById("profile-post-grid").innerHTML = "";
    document.querySelectorAll('#profile-tab-row .chip').forEach(c => c.classList.toggle("active", c.dataset.ptab === "posts"));

    try {
        const profile = await api.getUserProfile(uid);
        document.getElementById("profile-avatar").textContent = (profile.username || "?").slice(0, 2).toUpperCase();
        document.getElementById("profile-username").textContent = profile.username;

        const badges = [];
        if (profile.talent_category) badges.push(`<span class="talent-badge">${escapeHtml(talentLabel(profile.talent_category))}</span>`);
        if (profile.business_category) badges.push(`<span class="talent-badge">${escapeHtml(businessLabel(profile.business_category))}</span>`);
        document.getElementById("profile-badges").innerHTML = badges.join(" ");

        const locationParts = [profile.locality, profile.region, profile.country].filter(Boolean).join(", ");
        const metaParts = [locationParts];
        if (profile.date_of_birth) metaParts.push(`DOB: ${profile.date_of_birth}`);
        document.getElementById("profile-meta").textContent = metaParts.filter(Boolean).join(" · ");
        document.getElementById("profile-joined").textContent = profile.joined_at ? `Joined ${new Date(profile.joined_at).toLocaleDateString()} · ${profile.post_count} posts` : "";

        renderActions(profile);
        await loadTab(uid, "posts");
    } catch (e) {
        document.getElementById("profile-username").textContent = "Couldn't load profile";
        document.getElementById("profile-meta").textContent = e.message;
    }
}

export function initProfile() {
    const backBtn = document.getElementById("btn-back-from-profile");
    if (backBtn) backBtn.addEventListener("click", () => showPage("home"));

    document.querySelectorAll('#profile-tab-row .chip').forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll('#profile-tab-row .chip').forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentTab = chip.dataset.ptab;
            if (currentProfileUid) loadTab(currentProfileUid, currentTab);
        });
    });

    const ownProfileBtn = document.getElementById("btn-open-own-profile");
    if (ownProfileBtn) {
        ownProfileBtn.addEventListener("click", () => {
            const me = getCachedUser();
            if (me) openProfile(me.uid);
        });
    }

    const label = document.getElementById("own-username-label");
    const me = getCachedUser();
    if (label && me) label.textContent = me.username;
}

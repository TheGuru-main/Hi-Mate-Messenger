import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";
import { openChat } from "./chat.js";
import { buildConnectRow } from "./connect-utils.js";
import { renderPost } from "./feed.js";
import { talentLabel, businessLabel } from "./categories.js";
import { timeAgo, compressImage } from "./media-utils.js";

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
        posts.forEach(p => grid.appendChild(renderPost(p, { hideConnect: true })));
    } catch (e) {
        grid.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function renderActions(profile) {
    const box = document.getElementById("profile-actions");
    box.innerHTML = "";
    if (profile.is_me) return;
    const canDm = profile.klique_status === "accepted" || profile.is_contact;
    const row = buildConnectRow({
        uid: profile.uid,
        kliqueStatus: profile.klique_status,
        isFollowing: profile.is_following,
        messageLabel: canDm ? "Message" : "Message Request",
        onMessage: () => openChat(profile.uid, profile.username),
    });
    row.classList.add("profile-connect-row");
    box.appendChild(row);
}

function renderEditButton(profile) {
    const existing = document.getElementById("profile-edit-btn");
    if (existing) existing.remove();
    if (!profile.is_me) return;
    const btn = document.createElement("button");
    btn.id = "profile-edit-btn";
    btn.className = "secondary-btn profile-action-btn";
    btn.innerHTML = '<i class="fa-solid fa-pen"></i> Edit Profile';
    btn.addEventListener("click", () => openEditProfileModal(profile));
    document.getElementById("profile-actions").appendChild(btn);
}

function openEditProfileModal(profile) {
    const overlay = document.createElement("div");
    overlay.className = "klique-modal-overlay feed-modal-overlay";
    overlay.innerHTML = `
      <div class="status-composer">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Edit Profile</div>
          <button class="icon-btn edit-profile-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <label class="form-section label">Bio</label>
        <textarea class="input-box" id="edit-bio">${escapeHtml(profile.bio || "")}</textarea>
        <label class="form-section label">Education Level</label>
        <input class="input-box" id="edit-education" value="${escapeHtml(profile.education_level || "")}" placeholder="e.g. Bachelor's, Diploma, Self-taught">
        <label class="form-section label">Date of Birth</label>
        <input class="input-box" type="date" id="edit-dob" value="${profile.date_of_birth || ""}">
        <button class="primary-btn" id="save-profile-btn">Save</button>
        <div class="error-text" id="edit-profile-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".edit-profile-close").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#save-profile-btn").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#edit-profile-error");
        try {
            await api.updateMe({
                bio: overlay.querySelector("#edit-bio").value.trim(),
                education_level: overlay.querySelector("#edit-education").value.trim(),
                date_of_birth: overlay.querySelector("#edit-dob").value || null,
            });
            overlay.remove();
            if (currentProfileUid) openProfile(currentProfileUid);
        } catch (e) {
            errEl.textContent = e.message;
        }
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
        const avatarEl = document.getElementById("profile-avatar");
        const editAvatarBtn = document.getElementById("btn-edit-avatar");
        const editCoverBtn = document.getElementById("btn-edit-cover");
        const coverEl = document.getElementById("profile-cover");

        if (profile.profile_image_url) {
            avatarEl.style.backgroundImage = `url(${profile.profile_image_url})`;
            avatarEl.textContent = "";
            avatarEl.appendChild(editAvatarBtn);
        } else {
            avatarEl.style.backgroundImage = "";
            avatarEl.textContent = (profile.username || "?").slice(0, 2).toUpperCase();
            avatarEl.appendChild(editAvatarBtn);
        }
        coverEl.style.backgroundImage = profile.cover_image_url ? `url(${profile.cover_image_url})` : "";

        editAvatarBtn.classList.toggle("hidden", !profile.is_me);
        editCoverBtn.classList.toggle("hidden", !profile.is_me);

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
        renderEditButton(profile);
        await loadTab(uid, "posts");
    } catch (e) {
        document.getElementById("profile-username").textContent = "Couldn't load profile";
        document.getElementById("profile-meta").textContent = e.message;
    }
}

async function uploadAndSetImage(file, field) {
    try {
        const toUpload = await compressImage(file);
        const res = await api.uploadMedia(toUpload);
        await api.updateMe({ [field]: res.media_ref });
        if (currentProfileUid) openProfile(currentProfileUid);
    } catch (e) {
        alert(`Upload failed: ${e.message}`);
    }
}

export function initProfile() {
    const avatarInput = document.getElementById("profile-avatar-input");
    const coverInput = document.getElementById("profile-cover-input");
    const editAvatarBtn = document.getElementById("btn-edit-avatar");
    const editCoverBtn = document.getElementById("btn-edit-cover");

    if (editAvatarBtn && avatarInput) {
        editAvatarBtn.addEventListener("click", (e) => { e.stopPropagation(); avatarInput.click(); });
        avatarInput.addEventListener("change", () => {
            if (avatarInput.files.length) uploadAndSetImage(avatarInput.files[0], "profile_image_ref");
            avatarInput.value = "";
        });
    }
    if (editCoverBtn && coverInput) {
        editCoverBtn.addEventListener("click", () => coverInput.click());
        coverInput.addEventListener("change", () => {
            if (coverInput.files.length) uploadAndSetImage(coverInput.files[0], "cover_image_ref");
            coverInput.value = "";
        });
    }

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

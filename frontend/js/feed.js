import { api, getCachedUser } from "./api.js";

const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "✅", "🙏", "🙋", "👏", "🚀", "🎓", "📍", "💪", "💎"];
const LONG_PRESS_MS = 450;

let pendingMediaRefs = [];
let mediaRecorder = null;
let recordedChunks = [];

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

function timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
}

function isVideoRef(ref) {
    return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(ref || "");
}

function renderCarousel(mediaRefs) {
    if (!mediaRefs || !mediaRefs.length) return "";
    const slides = mediaRefs.map(ref => {
        const tag = isVideoRef(ref)
            ? `<video src="${ref}" class="carousel-media" controls playsinline></video>`
            : `<img src="${ref}" class="carousel-media" loading="lazy">`;
        return `<div class="carousel-slide">${tag}</div>`;
    }).join("");
    const dots = mediaRefs.length > 1
        ? `<div class="carousel-dots">${mediaRefs.map((_, i) => `<span class="carousel-dot${i === 0 ? " active" : ""}"></span>`).join("")}</div>`
        : "";
    return `<div class="media-carousel"><div class="carousel-track">${slides}</div>${dots}</div>`;
}

function wireCarousel(cardEl) {
    const track = cardEl.querySelector(".carousel-track");
    if (!track) return;
    const dots = cardEl.querySelectorAll(".carousel-dot");
    let startX = 0;
    let scrolling = false;

    track.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; scrolling = true; }, { passive: true });
    track.addEventListener("touchmove", () => {}, { passive: true });
    track.addEventListener("touchend", (e) => {
        if (!scrolling) return;
        scrolling = false;
        const delta = startX - e.changedTouches[0].clientX;
        if (Math.abs(delta) < 40) return;
        const slideWidth = track.clientWidth;
        track.scrollTo({ left: track.scrollLeft + (delta > 0 ? slideWidth : -slideWidth), behavior: "smooth" });
    });
    track.addEventListener("scroll", () => {
        const idx = Math.round(track.scrollLeft / track.clientWidth);
        dots.forEach((d, i) => d.classList.toggle("active", i === idx));
    });
}

function closeReactionPopover() {
    const existing = document.querySelector(".reaction-popover");
    if (existing) existing.remove();
}

function openReactionPopover(anchorBtn, postId, onPicked) {
    closeReactionPopover();
    const popover = document.createElement("div");
    popover.className = "reaction-popover";
    popover.innerHTML = REACTIONS.map(e => `<button class="reaction-pick" data-emoji="${e}">${e}</button>`).join("");
    document.body.appendChild(popover);

    const rect = anchorBtn.getBoundingClientRect();
    const maxLeft = window.innerWidth - popover.offsetWidth - 8;
    popover.style.left = Math.min(Math.max(8, rect.left - 20), Math.max(8, maxLeft)) + "px";

    let top = rect.top - popover.offsetHeight - 10 + window.scrollY;
    if (top < window.scrollY + 8) top = rect.bottom + 10 + window.scrollY;
    popover.style.top = top + "px";

    popover.querySelectorAll(".reaction-pick").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const emoji = btn.dataset.emoji;
            closeReactionPopover();
            try { await api.react(postId, emoji); if (onPicked) onPicked(emoji); } catch (e) { console.error(e); }
        });
    });
    setTimeout(() => document.addEventListener("click", closeReactionPopover, { once: true }), 0);
}

function wireLongPress(btn, postId, onPicked) {
    let pressTimer = null;
    let longPressed = false;
    const start = () => {
        longPressed = false;
        pressTimer = setTimeout(() => { longPressed = true; openReactionPopover(btn, postId, onPicked); }, LONG_PRESS_MS);
    };
    const cancel = () => clearTimeout(pressTimer);
    btn.addEventListener("touchstart", start, { passive: true });
    btn.addEventListener("touchend", cancel);
    btn.addEventListener("touchmove", cancel);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", cancel);
    btn.addEventListener("mouseleave", cancel);
    btn.addEventListener("click", async () => {
        if (longPressed) return;
        try { await api.react(postId, "💎"); if (onPicked) onPicked("💎"); } catch (e) { console.error(e); }
    });
}

function closeOverlay() {
    const existing = document.querySelector(".feed-modal-overlay");
    if (existing) existing.remove();
}

function renderCommentItem(c) {
    const initials = (c.author_username || "?").slice(0, 2).toUpperCase();
    return `
      <div class="comment-item" data-comment-id="${c.id}">
        <div class="avatar small">${initials}</div>
        <div class="comment-body">
          <div class="comment-author">${escapeHtml(c.author_username)}</div>
          <div class="comment-text">${escapeHtml(c.content || "")}</div>
          <div class="comment-actions">
            <button class="comment-action-btn" data-action="reply">Reply</button>
            <button class="comment-action-btn comment-react-btn" data-action="react">React</button>
          </div>
        </div>
      </div>
    `;
}

async function openCommentBox(postId) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "feed-modal-overlay";
    overlay.innerHTML = `
      <div class="comment-box">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Comments</div>
          <button class="icon-btn comment-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="comment-list" id="comment-list"><div class="section-title">Loading…</div></div>
        <div class="comment-reply-context hidden" id="comment-reply-context"></div>
        <div class="comment-input-row">
          <input class="input-box" id="comment-input" placeholder="Add a comment…">
          <button class="send-btn" id="comment-send-btn"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".comment-close").addEventListener("click", closeOverlay);

    const listEl = overlay.querySelector("#comment-list");
    let replyTo = null;

    async function refresh() {
        try {
            const comments = await api.getComments(postId);
            listEl.innerHTML = comments.length ? comments.map(renderCommentItem).join("") : '<div class="section-title">No comments yet — be the first.</div>';
            listEl.scrollTop = listEl.scrollHeight;
            wireCommentButtons();
        } catch (e) {
            listEl.innerHTML = `<div class="error-text">${e.message}</div>`;
        }
    }

    function wireCommentButtons() {
        listEl.querySelectorAll('[data-action="reply"]').forEach(btn => {
            btn.addEventListener("click", () => {
                const item = btn.closest(".comment-item");
                replyTo = item.dataset.commentId;
                const ctx = overlay.querySelector("#comment-reply-context");
                ctx.classList.remove("hidden");
                ctx.innerHTML = `Replying to ${item.querySelector(".comment-author").textContent} <button id="cancel-reply">&times;</button>`;
                ctx.querySelector("#cancel-reply").addEventListener("click", () => { replyTo = null; ctx.classList.add("hidden"); });
                overlay.querySelector("#comment-input").focus();
            });
        });
        listEl.querySelectorAll(".comment-react-btn").forEach(btn => {
            wireLongPress(btn, listEl.querySelectorAll(".comment-react-btn").length ? null : null, null); // placeholder, replaced below
        });
        listEl.querySelectorAll(".comment-react-btn").forEach(btn => {
            const item = btn.closest(".comment-item");
            const commentId = item.dataset.commentId;
            btn.onclick = async () => {
                try { await api.reactToComment(commentId, "👍"); btn.textContent = "👍"; } catch (e) { console.error(e); }
            };
        });
    }

    overlay.querySelector("#comment-send-btn").addEventListener("click", async () => {
        const input = overlay.querySelector("#comment-input");
        const content = input.value.trim();
        if (!content) return;
        input.value = "";
        try {
            await api.addComment(postId, { content, parent_comment_id: replyTo });
            replyTo = null;
            overlay.querySelector("#comment-reply-context").classList.add("hidden");
            await refresh();
        } catch (e) {
            alert(e.message);
        }
    });

    refresh();
}

async function openSharePicker(post) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "feed-modal-overlay";

    let kliques = [];
    try { kliques = await api.kliqueList(); } catch (e) {}
    const me = getCachedUser();
    const kliqueOptions = kliques.map(k => {
        const otherUid = k.from_uid === (me ? me.uid : null) ? k.to_uid : k.from_uid;
        return `<label class="status-recipient-option"><input type="checkbox" value="${otherUid}"> ${escapeHtml(otherUid)}</label>`;
    }).join("");

    overlay.innerHTML = `
      <div class="share-picker">
        <div class="status-viewer-header">
          <div class="status-viewer-name">Share</div>
          <button class="icon-btn share-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <button class="secondary-btn" id="share-to-feed"><i class="fa-solid fa-arrow-rotate-right"></i> Share to Feed</button>
        <button class="secondary-btn" id="share-external"><i class="fa-solid fa-up-right-from-square"></i> Share Externally</button>
        <div class="section-title">Or send to Kliques</div>
        <div class="status-recipients">${kliqueOptions || '<div class="section-title">No Kliques yet</div>'}</div>
        <button class="primary-btn" id="share-to-kliques">Send</button>
        <div class="error-text" id="share-error"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".share-close").addEventListener("click", closeOverlay);

    overlay.querySelector("#share-to-feed").addEventListener("click", async () => {
        try {
            await api.createPost({
                category: post.category,
                content: `🔁 Shared: ${post.content || ""}`,
                media_refs: post.media_refs || [],
            });
            closeOverlay();
            loadFeed();
        } catch (e) {
            alert(e.message);
        }
    });

    overlay.querySelector("#share-external").addEventListener("click", async () => {
        const shareText = post.content || "Check out this post on Hi-Mate";
        if (navigator.share) {
            try { await navigator.share({ text: shareText }); } catch (e) {}
        } else {
            try { await navigator.clipboard.writeText(shareText); alert("Copied to clipboard"); } catch (e) {}
        }
        closeOverlay();
    });

    overlay.querySelector("#share-to-kliques").addEventListener("click", async () => {
        const errEl = overlay.querySelector("#share-error");
        const targets = Array.from(overlay.querySelectorAll(".status-recipient-option input:checked")).map(el => el.value);
        if (!targets.length) { errEl.textContent = "Pick at least one Klique."; return; }
        try {
            await Promise.all(targets.map(uid => api.sendMessage({ receiver_uid: uid, type: "text", content: `Shared a post: ${post.content || "(media)"}` })));
            closeOverlay();
        } catch (e) {
            errEl.textContent = e.message;
        }
    });
}

function renderPost(post) {
    const div = document.createElement("div");
    div.className = "card feed-card";
    const initials = (post.author_username || "?").slice(0, 2).toUpperCase();
    const locationParts = [post.author_locality, post.author_region].filter(Boolean).join(", ");
    const talentBadge = post.author_talent_category ? `<span class="talent-badge">${escapeHtml(post.author_talent_category)}</span>` : "";

    div.innerHTML = `
      <div class="post-header">
        <div class="avatar">${initials}</div>
        <div class="post-header-text">
          <div class="post-author-name">${escapeHtml(post.author_username || post.author_uid)} ${talentBadge}</div>
          <div class="post-meta">${locationParts ? escapeHtml(locationParts) + " · " : ""}${post.category} · ${timeAgo(post.created_at)}</div>
        </div>
      </div>
      ${post.content ? `<div class="content">${escapeHtml(post.content)}</div>` : ""}
      ${renderCarousel(post.media_refs)}
      <div class="action-row">
        <button class="action-btn" data-action="comment"><i class="fa-regular fa-comment"></i> ${post.comment_count || ""}</button>
        <button class="action-btn" data-action="share"><i class="fa-solid fa-share"></i></button>
        <button class="action-btn gem-btn" data-action="gem"><i class="fa-solid fa-gem"></i></button>
      </div>
    `;

    wireCarousel(div);
    const gemBtn = div.querySelector(".gem-btn");
    wireLongPress(gemBtn, post.id, (emoji) => { gemBtn.innerHTML = emoji; gemBtn.classList.add("active"); });

    div.querySelector('[data-action="comment"]').addEventListener("click", () => openCommentBox(post.id));
    div.querySelector('[data-action="share"]').addEventListener("click", () => openSharePicker(post));

    return div;
}

export async function loadFeed() {
    const list = document.getElementById("feed-list");
    if (!list) return;
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const posts = await api.getFeed();
        list.innerHTML = "";
        if (!posts.length) {
            list.innerHTML = '<div class="section-title">No posts yet — be the first to share something.</div>';
            return;
        }
        posts.forEach(p => list.appendChild(renderPost(p)));
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

function renderMediaPreview() {
    const box = document.getElementById("post-media-preview");
    if (!box) return;
    box.innerHTML = pendingMediaRefs.map((ref, i) => `
      <div class="media-chip">
        <span>${isVideoRef(ref) ? "🎬" : "🖼️"} attached</span>
        <button type="button" class="media-chip-remove" data-idx="${i}">&times;</button>
      </div>
    `).join("");
    box.querySelectorAll(".media-chip-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            pendingMediaRefs.splice(Number(btn.dataset.idx), 1);
            renderMediaPreview();
        });
    });
}

const MAX_DIMENSION = 1600; // long-edge cap — large enough to look sharp full-screen, small enough to keep uploads fast
const JPEG_QUALITY = 0.9;   // high quality, still meaningfully smaller than an uncompressed phone photo

function compressImage(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith("image/") || file.type === "image/gif") {
            resolve(file); // don't touch GIFs (would break animation) or non-images
            return;
        }
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => { img.src = e.target.result; };
        img.onload = () => {
            let { width, height } = img;
            if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
                resolve(file); // already small enough, skip re-encoding entirely
                return;
            }
            const scale = MAX_DIMENSION / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (!blob) { resolve(file); return; }
                resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
            }, "image/jpeg", JPEG_QUALITY);
        };
        img.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

async function handleMediaFiles(files) {
    for (const file of files) {
        try {
            const toUpload = await compressImage(file);
            const res = await api.uploadMedia(toUpload);
            pendingMediaRefs.push(res.media_ref);
        } catch (e) {
            alert(`Upload failed: ${e.message}`);
        }
    }
    renderMediaPreview();
}

let recordingTimerInterval = null;
let recordingStartedAt = null;

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

async function toggleVoiceRecording(btn) {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };

        const timerLabel = document.getElementById("voice-timer");
        recordingStartedAt = Date.now();
        if (timerLabel) {
            timerLabel.classList.remove("hidden");
            timerLabel.textContent = "00:00";
            recordingTimerInterval = setInterval(() => {
                timerLabel.textContent = formatDuration(Date.now() - recordingStartedAt);
            }, 250);
        }

        mediaRecorder.onstop = async () => {
            btn.classList.remove("recording");
            clearInterval(recordingTimerInterval);
            const finalDuration = formatDuration(Date.now() - recordingStartedAt);
            if (timerLabel) { timerLabel.textContent = ""; timerLabel.classList.add("hidden"); }
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(recordedChunks, { type: "audio/webm" });
            const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
            file.durationLabel = finalDuration;
            await handleMediaFiles([file]);
        };
        mediaRecorder.start();
        btn.classList.add("recording");
    } catch (e) {
        alert("Microphone access denied or unavailable.");
    }
}

export function initFeed() {
    const btn = document.getElementById("btn-create-post");
    if (!btn) return;

    const mediaInput = document.getElementById("post-media-input");
    const attachBtn = document.getElementById("btn-attach-media");
    const voiceBtn = document.getElementById("btn-record-voice");

    if (attachBtn && mediaInput) {
        attachBtn.addEventListener("click", () => mediaInput.click());
        mediaInput.addEventListener("change", () => {
            if (mediaInput.files.length) handleMediaFiles(Array.from(mediaInput.files));
            mediaInput.value = "";
        });
    }
    if (voiceBtn) voiceBtn.addEventListener("click", () => toggleVoiceRecording(voiceBtn));

    btn.addEventListener("click", async () => {
        const category = document.getElementById("post-category").value;
        const content = document.getElementById("post-content").value.trim();
        if (!category) return alert("Pick a category first.");
        if (!content && !pendingMediaRefs.length) return alert("Write something or attach media first.");
        try {
            await api.createPost({ category, content, media_refs: pendingMediaRefs });
            document.getElementById("post-content").value = "";
            document.getElementById("post-category").value = "";
            pendingMediaRefs = [];
            renderMediaPreview();
            loadFeed();
        } catch (e) {
            alert(e.message);
        }
    });
}

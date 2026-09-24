import { api } from "./api.js";

const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "✅", "🙏", "🙋", "👏", "🚀", "🎓", "📍", "💪", "💎"];
const LONG_PRESS_MS = 450;

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

    track.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
        scrolling = true;
    }, { passive: true });

    track.addEventListener("touchmove", () => {}, { passive: true });

    track.addEventListener("touchend", (e) => {
        if (!scrolling) return;
        scrolling = false;
        const endX = e.changedTouches[0].clientX;
        const delta = startX - endX;
        if (Math.abs(delta) < 40) return;
        const slideWidth = track.clientWidth;
        const nextScroll = track.scrollLeft + (delta > 0 ? slideWidth : -slideWidth);
        track.scrollTo({ left: nextScroll, behavior: "smooth" });
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
    popover.style.left = Math.max(8, rect.left - 20) + "px";
    popover.style.top = (rect.top - popover.offsetHeight - 10 + window.scrollY) + "px";

    popover.querySelectorAll(".reaction-pick").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const emoji = btn.dataset.emoji;
            closeReactionPopover();
            try { await api.react(postId, emoji); if (onPicked) onPicked(emoji); } catch (e) { console.error(e); }
        });
    });

    setTimeout(() => {
        document.addEventListener("click", closeReactionPopover, { once: true });
    }, 0);
}

function wireLongPress(btn, postId, onPicked) {
    let pressTimer = null;
    let longPressed = false;

    const start = () => {
        longPressed = false;
        pressTimer = setTimeout(() => {
            longPressed = true;
            openReactionPopover(btn, postId, onPicked);
        }, LONG_PRESS_MS);
    };
    const cancel = () => clearTimeout(pressTimer);

    btn.addEventListener("touchstart", start, { passive: true });
    btn.addEventListener("touchend", cancel);
    btn.addEventListener("touchmove", cancel);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", cancel);
    btn.addEventListener("mouseleave", cancel);

    btn.addEventListener("click", async () => {
        if (longPressed) return; // handled by popover pick instead
        try { await api.react(postId, "💎"); if (onPicked) onPicked("💎"); } catch (e) { console.error(e); }
    });
}

function renderPost(post) {
    const div = document.createElement("div");
    div.className = "card feed-card";

    const initials = (post.author_username || "?").slice(0, 2).toUpperCase();
    const locationParts = [post.author_locality, post.author_region].filter(Boolean).join(", ");
    const talentBadge = post.author_talent_category
        ? `<span class="talent-badge">${escapeHtml(post.author_talent_category)}</span>`
        : "";

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
    wireLongPress(gemBtn, post.id, (emoji) => {
        gemBtn.innerHTML = `${emoji}`;
        gemBtn.classList.add("active");
    });

    const shareBtn = div.querySelector('[data-action="share"]');
    shareBtn.addEventListener("click", async () => {
        const shareText = post.content || "Check out this post on Hi-Mate";
        if (navigator.share) {
            try { await navigator.share({ text: shareText }); } catch (e) { /* user cancelled */ }
        } else {
            try {
                await navigator.clipboard.writeText(shareText);
                alert("Copied to clipboard");
            } catch (e) { /* clipboard unavailable */ }
        }
    });

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

export function initFeed() {
    const btn = document.getElementById("btn-create-post");
    if (!btn) return;
    btn.addEventListener("click", async () => {
        const category = document.getElementById("post-category").value;
        const content = document.getElementById("post-content").value.trim();
        if (!category) return alert("Pick a category first.");
        if (!content) return alert("Write something first.");
        try {
            await api.createPost({ category, content, media_refs: [] });
            document.getElementById("post-content").value = "";
            document.getElementById("post-category").value = "";
            loadFeed();
        } catch (e) {
            alert(e.message);
        }
    });
}

import { api } from "./api.js";

const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "✅", "🙏", "🙋", "👏", "🚀", "🎓", "📍", "💪"];

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

function renderPost(post) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="meta">${post.category || ""} · ${timeAgo(post.created_at)}</div>
      <div class="content">${escapeHtml(post.content)}</div>
      <div class="actions">
        ${REACTIONS.slice(0, 6).map(e => `<button class="reaction-btn" data-post="${post.id}" data-emoji="${e}">${e}</button>`).join("")}
      </div>
    `;
    div.querySelectorAll(".reaction-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            btn.classList.add("active");
            try { await api.react(btn.dataset.post, btn.dataset.emoji); } catch (e) { console.error(e); }
        });
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
            await api.createPost({ category, content });
            document.getElementById("post-content").value = "";
            document.getElementById("post-category").value = "";
            loadFeed();
        } catch (e) {
            alert(e.message);
        }
    });
}

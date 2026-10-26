// Profile summary: Kliques, followers, following, gems, gigs completed, gig score, and the Edu details.
import { api, getCachedUser } from "./api.js";
import { orderProfileBoxes } from "./profile-layout.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const fmt = (n) => Number(n || 0).toLocaleString();

let profileUid = null;

const isOwn = (uid) => {
  const me = getCachedUser();
  return !!(me && String(me.uid) === String(uid));
};

function ensureBox() {
  let b = document.getElementById("profile-extras");
  if (b) return b;
  const anchor = document.getElementById("profile-actions");
  if (!anchor || !anchor.parentNode) return null;
  b = document.createElement("div");
  b.id = "profile-extras";
  b.className = "pc-section hidden";
  anchor.parentNode.insertBefore(b, anchor);
  return b;
}

const cell = (label, value) =>
  `<div class="ps-cell"><div class="ps-val">${esc(fmt(value))}</div><div class="ps-lab">${esc(label)}</div></div>`;

function eduHtml(edu, own) {
  if (!edu) return "";
  const rows = [["Level", edu.level], ["School", edu.school], ["Class", edu.class], ["Stage", edu.stage], ["Name on Edu", edu.name]]
    .filter(([, v]) => v);
  if (!rows.length) {
    return own
      ? '<div class="pc-section-title">Education</div><div class="md-muted">Add your school, class and stage in the Edu page (the 🎓 button at the top).</div>'
      : "";
  }
  return `<div class="pc-section-title">Education</div>${rows
    .map(([l, v]) => `<div class="eco-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("")}`;
}

export async function renderProfileExtras(uid) {
  profileUid = uid;
  const b = ensureBox();
  if (!b) return;
  orderProfileBoxes();
  try {
    const d = await api.getProfileExtras(uid);
    if (profileUid !== uid) return;
    b.innerHTML = `
      <div class="ps-grid">
        ${cell("Kliques", d.kliques)}${cell("Followers", d.followers)}${cell("Following", d.following)}
        ${cell("Gems", d.gems)}${cell("Gigs completed", d.gigs_completed)}${cell("Gig score", d.gig_score)}
      </div>
      ${eduHtml(d.edu, isOwn(uid))}`;
    b.classList.remove("hidden");
    orderProfileBoxes();
  } catch (e) {
    b.classList.add("hidden");
  }
}

// After the Edu page is saved, refresh your own profile block shortly after.
document.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest("#edu-save-btn")) {
    setTimeout(() => { if (profileUid && isOwn(profileUid)) renderProfileExtras(profileUid); }, 2000);
  }
});

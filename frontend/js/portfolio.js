// Portfolio + credentials: profile buttons, list sheets and add forms. Files reuse /media/upload.
import { api, getCachedUser } from "./api.js";
import { openSheet } from "./sheet.js";
import { talentLabel, businessLabel } from "./categories.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const KIND = {
  video: ["Video", "fa-video"], audio: ["Audio", "fa-music"], image: ["Image", "fa-image"],
  document: ["Document", "fa-file-lines"], link: ["Link", "fa-link"], code: ["Code / repo", "fa-code"],
  product: ["Product", "fa-box"],
};
const ACCEPT = { video: "video/*", audio: "audio/*", image: "image/*", document: ".pdf,.docx", product: "image/*,.pdf,.docx" };
const MAX_MB = 25;
const SKEL = '<div class="md-skel"></div><div class="md-skel"></div>';

let templates = null;
let profileUid = null;

const isOwn = (uid) => { const me = getCachedUser(); return !!(me && String(me.uid) === String(uid)); };
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const catLabel = (type, code) => (!code ? "" : type === "business" ? businessLabel(code) : talentLabel(code));

/* ----------------------------- profile buttons ----------------------------- */

function ensureBox() {
  let b = document.getElementById("profile-portfolio");
  if (b) return b;
  const anchor = document.getElementById("profile-actions");
  if (!anchor || !anchor.parentNode) return null;
  b = document.createElement("div");
  b.id = "profile-portfolio";
  b.className = "pc-section hidden";
  anchor.parentNode.insertBefore(b, anchor);
  b.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pf]");
    if (!btn || !profileUid) return;
    if (btn.dataset.pf === "items") openPortfolio(profileUid);
    else openCredentials(profileUid);
  });
  return b;
}

export async function renderProfilePortfolio(uid) {
  profileUid = uid;
  const b = ensureBox();
  if (!b) return;
  try {
    const d = await api.getPortfolio(uid);
    if (profileUid !== uid) return;
    const n = d.items.length, c = d.credentials.length;
    if (!isOwn(uid) && !n && !c) {
      b.classList.add("hidden");
      b.innerHTML = "";
      return;
    }
    b.innerHTML = `<div class="pc-section-title">Portfolio &amp; credentials</div>
      <div class="pc-chips">
        <button type="button" class="pc-chip" data-pf="items"><i class="fa-solid fa-folder-open"></i><span>Portfolio (${n})</span></button>
        <button type="button" class="pc-chip" data-pf="creds"><i class="fa-solid fa-award"></i><span>Credentials (${c})</span></button>
      </div>`;
    b.classList.remove("hidden");
  } catch (e) {
    b.classList.add("hidden");
  }
}

/* -------------------------------- portfolio -------------------------------- */

function itemCard(i, own) {
  const [kl, icon] = KIND[i.kind] || ["Item", "fa-file"];
  const cat = catLabel(i.category_type, i.category_code);
  const vis = i.visibility === "kliques" ? "Kliques only" : i.visibility === "private" ? "Private" : "";
  const sub = [kl, cat, vis].filter(Boolean).map(esc).join(" · ");
  const thumb = i.kind === "image" && i.url
    ? `<img class="pf-thumb" src="${esc(safeUrl(i.url))}" alt="" loading="lazy">` : "";
  return `
    <div class="pf-card" data-id="${esc(i.id)}">
      <div class="pf-ico"><i class="fa-solid ${icon}"></i></div>
      <div class="pf-main">
        <div class="pf-title">${esc(i.title)}${i.pinned ? " ★" : ""}</div>
        <div class="pf-sub">${sub}</div>
        ${i.description ? `<div class="pf-desc">${esc(i.description)}</div>` : ""}
        ${thumb}
        <div class="pf-actions">
          ${i.url ? `<a class="pf-btn" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}
          ${own ? `<button type="button" class="pf-btn pf-pin">${i.pinned ? "Unpin" : "Pin"}</button><button type="button" class="pf-btn pf-del">Delete</button>` : ""}
        </div>
      </div>
    </div>`;
}

function portfolioHtml(d, own) {
  const add = own
    ? `<div class="md-pad"><button type="button" class="primary-btn pf-add">＋ Add to portfolio</button>
       <div class="ps-note">Up to ${esc(d.limits.items)} items. Never upload ID numbers or bank details.</div></div>` : "";
  const cards = d.items.map((i) => itemCard(i, own)).join("");
  return `${add}${cards || '<div class="md-muted md-pad">Nothing here yet.</div>'}`;
}

async function openPortfolio(uid) {
  const own = isOwn(uid);
  const sheet = openSheet({ title: "Portfolio", html: SKEL });
  let data = null;

  async function load() {
    try {
      data = await api.getPortfolio(uid);
      if (sheet.isOpen()) sheet.setHtml(portfolioHtml(data, own));
      renderProfilePortfolio(uid);
    } catch (e) {
      if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    }
  }

  sheet.body.addEventListener("click", async (e) => {
    if (e.target.closest(".pf-add")) { openItemForm(load); return; }
    const card = e.target.closest(".pf-card");
    if (!card || !own) return;
    const id = card.dataset.id;
    try {
      if (e.target.closest(".pf-del")) {
        if (!confirm("Delete this item?")) return;
        await api.deletePortfolioItem(id);
        await load();
      } else if (e.target.closest(".pf-pin")) {
        const item = (data.items || []).find((i) => i.id === id);
        await api.updatePortfolioItem(id, { pinned: !(item && item.pinned) });
        await load();
      }
    } catch (err) {
      alert(err.message || "Couldn't update");
    }
  });

  await load();
}

async function openItemForm(onDone) {
  if (!templates) {
    try { templates = await api.getPortfolioTemplates(); } catch (e) { alert(e.message); return; }
  }
  const mine = templates.mine || {};
  const sheet = openSheet({ title: "Add to portfolio", html: `
    <div class="pf-form">
      <label>Category type</label>
      <select class="input-box" data-f="ctype"><option value="talent">Talent</option><option value="business">Business</option></select>
      <label>Category</label>
      <select class="input-box" data-f="ccode"></select>
      <div class="ps-note" data-f="hint"></div>
      <label>Type</label>
      <select class="input-box" data-f="kind"></select>
      <label>Title</label>
      <input class="input-box" data-f="title" maxlength="120" placeholder="e.g. Live set at Campus Fest">
      <label>Description <span class="optional-tag">optional</span></label>
      <textarea class="input-box" data-f="desc" maxlength="1000" rows="3"></textarea>
      <div data-f="filerow"><label>File</label><input type="file" class="input-box" data-f="file"></div>
      <label data-f="linklabel">Link (optional)</label>
      <input class="input-box" data-f="link" placeholder="https://…" inputmode="url">
      <label>Who can see it</label>
      <select class="input-box" data-f="vis"><option value="public">Everyone</option><option value="kliques">My Kliques</option><option value="private">Only me</option></select>
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Save</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);

  const tpl = () => ((templates[q("ctype").value] || {})[q("ccode").value]) || templates.default;

  function fillCodes() {
    const t = q("ctype").value;
    q("ccode").innerHTML = '<option value="">Not specified</option>' +
      Object.keys(templates[t] || {}).map((c) => `<option value="${esc(c)}">${esc(catLabel(t, c))}</option>`).join("");
    const pre = t === "talent" ? mine.talent : mine.business;
    if (pre && (templates[t] || {})[pre]) q("ccode").value = pre;
  }

  function toggle() {
    const k = q("kind").value;
    const linkOnly = k === "link" || k === "code";
    q("filerow").style.display = linkOnly ? "none" : "";
    q("file").setAttribute("accept", ACCEPT[k] || "");
    q("linklabel").textContent = linkOnly ? "Link (required)" : "Link (optional)";
  }

  function fillKinds() {
    const t = tpl();
    const rec = t.kinds || [];
    const order = rec.concat(Object.keys(KIND).filter((k) => !rec.includes(k)));
    q("kind").innerHTML = order.map((k) => `<option value="${k}">${esc(KIND[k][0])}${rec.includes(k) ? " ★" : ""}</option>`).join("");
    q("hint").textContent = t.hint || "";
    toggle();
  }

  q("ctype").value = mine.talent ? "talent" : mine.business ? "business" : "talent";
  fillCodes();
  fillKinds();
  q("ctype").addEventListener("change", () => { fillCodes(); fillKinds(); });
  q("ccode").addEventListener("change", fillKinds);
  q("kind").addEventListener("change", toggle);

  q("save").addEventListener("click", async () => {
    const err = q("err");
    err.textContent = "";
    const title = q("title").value.trim();
    const kind = q("kind").value;
    const file = q("file").files[0];
    const link = q("link").value.trim();
    if (!title) { err.textContent = "Add a title."; return; }
    if (file && file.size > MAX_MB * 1024 * 1024) { err.textContent = `That file is over ${MAX_MB}MB.`; return; }
    if ((kind === "link" || kind === "code") && !link) { err.textContent = "Add the link."; return; }
    if (!file && !link && kind !== "product") { err.textContent = "Add a file or a link."; return; }
    const btn = q("save");
    btn.disabled = true;
    try {
      let mediaRef = null;
      if (file) {
        btn.textContent = "Uploading…";
        mediaRef = (await api.uploadPortfolioFile(file)).media_ref;
      }
      btn.textContent = "Saving…";
      await api.addPortfolioItem({
        kind, title,
        description: q("desc").value.trim() || null,
        category_type: q("ctype").value,
        category_code: q("ccode").value || null,
        media_ref: mediaRef,
        link_url: link || null,
        visibility: q("vis").value,
      });
      sheet.close();
      onDone();
    } catch (e) {
      err.textContent = e.message || "Couldn't save.";
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

/* ------------------------------- credentials ------------------------------- */

function credCard(c, own) {
  const years = c.type === "work"
    ? `${c.start_year || "?"} – ${c.end_year || "present"}`
    : (c.start_year || "");
  const sub = [c.org, years].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="pf-card" data-id="${esc(c.id)}">
      <div class="pf-ico"><i class="fa-solid ${c.type === "work" ? "fa-briefcase" : "fa-award"}"></i></div>
      <div class="pf-main">
        <div class="pf-title">${esc(c.title)}</div>
        <div class="pf-sub">${sub}</div>
        ${c.description ? `<div class="pf-desc">${esc(c.description)}</div>` : ""}
        <div class="pf-sub">Self-declared</div>
        <div class="pf-actions">
          ${c.proof_url ? `<a class="pf-btn" href="${esc(safeUrl(c.proof_url))}" target="_blank" rel="noopener noreferrer">View proof</a>` : ""}
          ${own ? '<button type="button" class="pf-btn pf-del">Delete</button>' : ""}
        </div>
      </div>
    </div>`;
}

function credsHtml(d, own) {
  const work = d.credentials.filter((c) => c.type === "work");
  const talent = d.credentials.filter((c) => c.type === "talent");
  const add = own
    ? `<div class="md-pad"><button type="button" class="primary-btn pf-add">＋ Add a credential</button>
       <div class="ps-note">Credentials are self-declared for now. Never upload ID numbers.</div></div>` : "";
  const block = (title, list) => (list.length
    ? `<div class="md-block"><div class="md-title">${esc(title)}</div>${list.map((c) => credCard(c, own)).join("")}</div>` : "");
  const body = block("Work", work) + block("Talent", talent);
  return `${add}${body || '<div class="md-muted md-pad">Nothing here yet.</div>'}`;
}

async function openCredentials(uid) {
  const own = isOwn(uid);
  const sheet = openSheet({ title: "Credentials", html: SKEL });

  async function load() {
    try {
      const d = await api.getPortfolio(uid);
      if (sheet.isOpen()) sheet.setHtml(credsHtml(d, own));
      renderProfilePortfolio(uid);
    } catch (e) {
      if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    }
  }

  sheet.body.addEventListener("click", async (e) => {
    if (e.target.closest(".pf-add")) { openCredentialForm(load); return; }
    const del = e.target.closest(".pf-del");
    const card = e.target.closest(".pf-card");
    if (!del || !card || !own) return;
    if (!confirm("Delete this credential?")) return;
    try {
      await api.deleteCredential(card.dataset.id);
      await load();
    } catch (err) {
      alert(err.message || "Couldn't delete");
    }
  });

  await load();
}

function openCredentialForm(onDone) {
  const sheet = openSheet({ title: "Add a credential", html: `
    <div class="pf-form">
      <label>Type</label>
      <select class="input-box" data-f="ctype"><option value="work">Work experience</option><option value="talent">Talent credential (certificate, award, training)</option></select>
      <label>Title</label>
      <input class="input-box" data-f="title" maxlength="120" placeholder="e.g. Lead guitarist, or Certified electrician">
      <label data-f="orglabel">Employer / organisation</label>
      <input class="input-box" data-f="org" maxlength="120">
      <label data-f="startlabel">Start year</label>
      <input class="input-box" data-f="start" inputmode="numeric" maxlength="4" placeholder="2022">
      <div data-f="endrow"><label>End year <span class="optional-tag">empty = present</span></label>
      <input class="input-box" data-f="end" inputmode="numeric" maxlength="4" placeholder="2025"></div>
      <label>Details <span class="optional-tag">optional</span></label>
      <textarea class="input-box" data-f="desc" maxlength="1000" rows="3"></textarea>
      <label>Proof <span class="optional-tag">optional photo or PDF</span></label>
      <input type="file" class="input-box" data-f="file" accept="image/*,.pdf,.docx">
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Save</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);

  function toggle() {
    const work = q("ctype").value === "work";
    q("orglabel").textContent = work ? "Employer / organisation" : "Issuer (school, body, event)";
    q("startlabel").textContent = work ? "Start year" : "Year";
    q("endrow").style.display = work ? "" : "none";
  }
  q("ctype").addEventListener("change", toggle);
  toggle();

  const year = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  q("save").addEventListener("click", async () => {
    const err = q("err");
    err.textContent = "";
    const title = q("title").value.trim();
    if (!title) { err.textContent = "Add a title."; return; }
    const file = q("file").files[0];
    if (file && file.size > MAX_MB * 1024 * 1024) { err.textContent = `That file is over ${MAX_MB}MB.`; return; }
    const btn = q("save");
    btn.disabled = true;
    try {
      let proof = null;
      if (file) {
        btn.textContent = "Uploading…";
        proof = (await api.uploadPortfolioFile(file)).media_ref;
      }
      btn.textContent = "Saving…";
      const work = q("ctype").value === "work";
      await api.addCredential({
        ctype: q("ctype").value, title,
        org: q("org").value.trim() || null,
        start_year: year(q("start").value),
        end_year: work ? year(q("end").value) : null,
        description: q("desc").value.trim() || null,
        proof_ref: proof,
      });
      sheet.close();
      onDone();
    } catch (e) {
      err.textContent = e.message || "Couldn't save.";
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

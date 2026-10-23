// Gigs hub: job opportunities + vacancy statuses (browse, post, bid, comment with portfolio pins, Klique-to-chat).
// Paid contests arrive in the next step.
import { api, getCachedUser } from "./api.js";
import { openSheet } from "./sheet.js";
import { showTab } from "./router.js";
import { talentLabel, businessLabel } from "./categories.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const SKEL = '<div class="md-skel"></div><div class="md-skel"></div>';
const JOB_TYPES = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", one_off: "One-off gig", internship: "Internship", volunteer: "Volunteer" };
const STATE_TXT = { open: "Open", shortlisting: "Shortlisting", filled: "Filled", closed: "Closed" };
const BID_TXT = { submitted: "Submitted", shortlisted: "Shortlisted", hired: "Hired", declined: "Declined" };
const KIND_ICON = { video: "fa-video", audio: "fa-music", image: "fa-image", document: "fa-file-lines", link: "fa-link", code: "fa-code", product: "fa-box" };
const KLIQUE_TXT = { none: "Klique & chat", accepted: "Message", pending_out: "Klique request sent", pending_in: "Accept their Klique request" };
const CONTESTS_NOTE = `<div class="md-block"><div class="md-title">Gig contests</div><div class="md-pad">Paid auditions and challenges (entry fees into a prize pool, live and poll voting) open in the next update. Hosting needs 50 followers and 50 mutual Kliques.</div></div>`;

let templates = null;
const myUid = () => (getCachedUser() || {}).uid;
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const where = (j) => (j.remote ? "Remote" : [j.locality, j.region, j.country].filter(Boolean).join(", "));
const catLabel = (type, code) => (!code ? "" : type === "business" ? businessLabel(code) : talentLabel(code));

/* --------------------------------- hub --------------------------------- */

function jobCard(j) {
  const kind = j.kind === "status" ? "Vacancy status" : (JOB_TYPES[j.job_type] || "Job");
  const end = j.kind === "status" && j.expires_at ? `Ends ${when(j.expires_at)}` : j.deadline ? `Deadline ${j.deadline}` : "";
  const bids = j.bids ? `${j.bids} bid${j.bids === 1 ? "" : "s"}` : "";
  const bits = [esc(j.poster_username || "Poster"), esc(where(j))].filter(Boolean).join(" · ");
  return `<div class="lv-card gg-job" data-id="${esc(j.id)}">
    <div class="lv-card-top"><span class="lv-badge">${esc(kind)}</span><span class="lv-badge">${esc(STATE_TXT[j.state] || j.state)}</span></div>
    <div class="lv-title">${esc(j.title)}</div>
    <div class="lv-sub">${bits}</div>
    ${j.pay_text ? `<div class="lv-sub">💰 ${esc(j.pay_text)}</div>` : ""}
    ${end || bids ? `<div class="lv-sub">${esc([end, bids].filter(Boolean).join(" · "))}</div>` : ""}
  </div>`;
}

function openGigsHub() {
  const sheet = openSheet({ title: "Gigs", html: `
    <div class="gg-actions">
      <button type="button" class="primary-btn gg-post-job">＋ Post a job opportunity</button>
      <button type="button" class="pf-btn gg-post-status">＋ Post your vacancy status</button>
      <button type="button" class="pf-btn gg-post-contest">＋ Post a gig contest</button>
    </div>
    <div class="chip-row">
      <button type="button" class="chip active" data-tab="jobs">Jobs</button>
      <button type="button" class="chip" data-tab="statuses">Vacancy statuses</button>
      <button type="button" class="chip" data-tab="contests">Contests</button>
      <button type="button" class="chip" data-tab="mine">My posts</button>
    </div>
    <div class="gg-filters">
      <select class="input-box" data-f="scope"><option value="global">Everywhere</option><option value="country">My country</option><option value="community">My community</option></select>
      <input class="input-box" data-f="q" placeholder="Search…" autocomplete="off">
    </div>
    <div data-f="list"></div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);
  let tab = "jobs";
  let timer = 0;

  async function load() {
    const box = q("list");
    if (tab === "contests") { box.innerHTML = CONTESTS_NOTE; return; }
    box.innerHTML = SKEL;
    const params = { scope: q("scope").value, q: q("q").value.trim() };
    if (tab === "jobs") params.kind = "opportunity";
    if (tab === "statuses") params.kind = "status";
    if (tab === "mine") params.mine = true;
    try {
      const rows = await api.getJobs(params);
      box.innerHTML = rows.length ? rows.map(jobCard).join("") : '<div class="lv-empty">Nothing here yet.</div>';
    } catch (e) {
      box.innerHTML = `<div class="match-data-error">${esc(e.message)}</div>`;
    }
  }

  sheet.body.addEventListener("click", (e) => {
    const t = e.target;
    const chip = t.closest(".chip[data-tab]");
    if (chip) {
      sheet.body.querySelectorAll(".chip[data-tab]").forEach((c) => c.classList.toggle("active", c === chip));
      tab = chip.dataset.tab;
      load();
      return;
    }
    if (t.closest(".gg-post-job")) { openJobForm("opportunity", load); return; }
    if (t.closest(".gg-post-status")) { openJobForm("status", load); return; }
    if (t.closest(".gg-post-contest")) { tab = "contests"; sheet.body.querySelectorAll(".chip[data-tab]").forEach((c) => c.classList.toggle("active", c.dataset.tab === "contests")); load(); return; }
    const card = t.closest(".gg-job");
    if (card) openJob(card.dataset.id, load);
  });
  q("scope").addEventListener("change", load);
  q("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 350); });
  load();
}

/* ------------------------------- post forms ------------------------------- */

async function openJobForm(kind, onDone) {
  if (!templates) {
    try { templates = await api.getPortfolioTemplates(); } catch (e) { alert(e.message); return; }
  }
  const status = kind === "status";
  const sheet = openSheet({ title: status ? "Post your vacancy status" : "Post a job opportunity", html: `
    <div class="pf-form">
      <label>${status ? "Headline" : "Job title"}</label>
      <input class="input-box" data-f="title" maxlength="120">
      ${status ? "" : `<label>Job type</label><select class="input-box" data-f="jtype">${Object.entries(JOB_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`}
      <label>Category <span class="optional-tag">optional</span></label>
      <select class="input-box" data-f="ctype"><option value="talent">Talent</option><option value="business">Business</option></select>
      <select class="input-box" data-f="ccode"></select>
      <label>${status ? "Details" : "Description"}</label>
      <textarea class="input-box" data-f="desc" rows="4" maxlength="${status ? 500 : 3000}"></textarea>
      ${status ? "" : '<label>Requirements <span class="optional-tag">optional</span></label><textarea class="input-box" data-f="req" rows="3" maxlength="2000"></textarea>'}
      <label>Pay <span class="optional-tag">optional</span></label>
      <input class="input-box" data-f="pay" maxlength="80" placeholder="e.g. ₦150,000 a month">
      <label><input type="checkbox" data-f="remote"> Remote / online</label>
      ${status
        ? '<label>Photo or video <span class="optional-tag">optional</span></label><input type="file" class="input-box" data-f="file" accept="image/*,video/*"><label>Stays up for</label><select class="input-box" data-f="dur"><option value="24h">24 hours</option><option value="3d" selected>3 days</option><option value="1w">1 week</option></select>'
        : '<label>Deadline <span class="optional-tag">optional</span></label><input type="date" class="input-box" data-f="deadline">'}
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Post</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);

  function fillCodes() {
    const t = q("ctype").value;
    q("ccode").innerHTML = '<option value="">Not specified</option>' +
      Object.keys(templates[t] || {}).map((c) => `<option value="${esc(c)}">${esc(catLabel(t, c))}</option>`).join("");
  }
  fillCodes();
  q("ctype").addEventListener("change", fillCodes);

  q("save").addEventListener("click", async () => {
    const err = q("err");
    err.textContent = "";
    const title = q("title").value.trim();
    if (title.length < 3) { err.textContent = "Add a title (at least 3 characters)."; return; }
    const btn = q("save");
    btn.disabled = true;
    try {
      const body = {
        kind, title,
        category_type: q("ccode").value ? q("ctype").value : null,
        category_code: q("ccode").value || null,
        remote: q("remote").checked,
        description: q("desc").value.trim() || null,
        pay_text: q("pay").value.trim() || null,
      };
      if (status) {
        body.duration = q("dur").value;
        const file = q("file").files[0];
        if (file) {
          if (file.size > 25 * 1024 * 1024) throw new Error("That file is over 25MB.");
          btn.textContent = "Uploading…";
          body.media_refs = [(await api.uploadPortfolioFile(file)).media_ref];
        }
      } else {
        body.job_type = q("jtype").value;
        body.requirements = q("req").value.trim() || null;
        body.deadline = q("deadline").value || null;
      }
      btn.textContent = "Posting…";
      await api.createJob(body);
      sheet.close();
      onDone();
    } catch (e) {
      err.textContent = e.message || "Couldn't post.";
      btn.disabled = false;
      btn.textContent = "Post";
    }
  });
}

/* --------------------------------- detail --------------------------------- */

function attChip(i) {
  return `<a class="pf-btn gg-chip" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid ${KIND_ICON[i.kind] || "fa-file"}"></i> ${esc(i.title)}</a>`;
}

function bidHtml(b, poster) {
  const att = [...(b.items || []).map(attChip),
    ...(b.credentials || []).map((c) => `<span class="pf-btn gg-chip"><i class="fa-solid fa-award"></i> ${esc(c.title)}</span>`)].join("");
  const btn = (act, label) => `<button type="button" class="pf-btn" data-bid="${esc(b.id)}" data-bidact="${act}">${label}</button>`;
  const acts = poster && b.status !== "hired"
    ? `<div class="pf-actions">${btn("shortlisted", "Shortlist")}${btn("hired", "Hire")}${btn("declined", "Decline")}</div>` : "";
  return `<div class="pf-card"><div class="pf-main">
    <div class="pf-title">${esc(b.bidder_username || "Applicant")} <span class="pf-sub">· ${esc(BID_TXT[b.status] || b.status)}</span></div>
    ${b.rate_text ? `<div class="pf-sub">Rate: ${esc(b.rate_text)}</div>` : ""}
    <div class="pf-desc">${esc(b.proposal)}</div>
    ${att ? `<div class="pf-actions">${att}</div>` : ""}${acts}</div></div>`;
}

function commentHtml(c, d) {
  const pins = (c.items || []).map(attChip).join("");
  const mine = c.author_uid === myUid();
  const tools = (d.is_poster ? `<button type="button" class="pf-btn gg-cpin" data-c="${esc(c.id)}">${c.pinned ? "Unpin" : "Pin"}</button>` : "") +
    (d.is_poster || mine ? `<button type="button" class="pf-btn gg-cdel" data-c="${esc(c.id)}">Delete</button>` : "");
  return `<div class="pf-card"><div class="pf-main">
    <div class="pf-title">${c.pinned ? "📌 " : ""}${esc(c.author_username || "User")} <span class="pf-sub">${esc(when(c.created_at))}</span></div>
    <div class="pf-desc">${esc(c.content)}</div>
    ${pins ? `<div class="pf-actions">${pins}</div>` : ""}${tools ? `<div class="pf-actions">${tools}</div>` : ""}</div></div>`;
}

function detailHtml(d) {
  const j = d.job;
  const kind = j.kind === "status" ? "Vacancy status" : (JOB_TYPES[j.job_type] || "Job");
  const media = (j.media || []).map((u) => (/\.(mp4|mov|webm)(\?|$)/i.test(u)
    ? `<video class="pf-thumb" src="${esc(safeUrl(u))}" controls playsinline preload="metadata"></video>`
    : `<img class="pf-thumb" src="${esc(safeUrl(u))}" alt="" loading="lazy">`)).join("");
  const meta = [where(j), j.pay_text && `💰 ${j.pay_text}`, j.deadline && `Deadline ${j.deadline}`,
    j.kind === "status" && j.expires_at && `Ends ${when(j.expires_at)}`, catLabel(j.category_type, j.category_code)].filter(Boolean).map(esc).join(" · ");
  const open = j.state === "open" || j.state === "shortlisting";

  let tools = "";
  if (d.is_poster) {
    tools = `
      <div class="md-block"><div class="md-title">Manage</div><div class="md-pad">
        <select class="input-box" data-f="state">${Object.entries(STATE_TXT).map(([k, v]) => `<option value="${k}"${k === j.state ? " selected" : ""}>${v}</option>`).join("")}</select>
        <button type="button" class="pf-btn gg-setstate">Update status</button></div></div>
      <div class="md-block"><div class="md-title">Bids<span class="md-sub">${d.bids.length}</span></div>
        ${d.bids.map((b) => bidHtml(b, true)).join("") || '<div class="md-muted md-pad">No bids yet.</div>'}</div>`;
  }

  let apply = "";
  if (!d.is_poster) {
    if (d.my_bid) {
      apply = `<div class="md-block"><div class="md-title">Your bid<span class="md-sub">${esc(BID_TXT[d.my_bid.status] || d.my_bid.status)}</span></div>
        <div class="md-pad">${esc(d.my_bid.proposal)}</div>
        <div class="md-pad"><button type="button" class="pf-btn gg-withdraw">Withdraw bid</button></div></div>`;
    } else if (open) {
      apply = `<div class="md-block"><div class="md-title">Place a bid</div><div class="pf-form">
        <label>Your proposal</label>
        <textarea class="input-box" data-f="proposal" rows="4" maxlength="2000" placeholder="Why you're a fit, your plan, your timeline…"></textarea>
        <label>Your rate <span class="optional-tag">optional</span></label>
        <input class="input-box" data-f="rate" maxlength="60" placeholder="e.g. ₦80,000 flat">
        <div class="gg-attach-list"></div>
        <button type="button" class="pf-btn gg-attach-load">Attach portfolio and credentials (up to 5)</button>
        <button type="button" class="primary-btn gg-bid-send">Send bid</button></div></div>`;
    } else {
      apply = '<div class="md-muted md-pad">This post isn\'t taking bids.</div>';
    }
  }

  return `
    <div class="gg-detail">
      <div class="lv-card-top"><span class="lv-badge">${esc(kind)}</span><span class="lv-badge">${esc(STATE_TXT[j.state] || j.state)}</span></div>
      <div class="lv-title">${esc(j.title)}</div>
      <div class="lv-sub">${esc(j.poster_username || "Poster")}</div>
      ${meta ? `<div class="lv-sub">${meta}</div>` : ""}
      ${media}
      ${j.description ? `<div class="pf-desc gg-text">${esc(j.description)}</div>` : ""}
      ${j.requirements ? `<div class="md-title">Requirements</div><div class="pf-desc gg-text">${esc(j.requirements)}</div>` : ""}
    </div>
    ${!d.is_poster ? `<div class="md-pad"><button type="button" class="pf-btn gg-klique">${esc(KLIQUE_TXT[d.poster_klique] || "Klique & chat")}</button></div>` : ""}
    ${tools}
    ${apply}
    <div class="md-block"><div class="md-title">Comments<span class="md-sub">${d.comments.length}</span></div>
      ${d.comments.map((c) => commentHtml(c, d)).join("")}
      <div class="pf-form">
        <textarea class="input-box" data-f="comment" rows="3" maxlength="800" placeholder="Ask a question or add context. Type @username to mention one of your Kliques."></textarea>
        <div class="gg-pin-list"></div>
        <button type="button" class="pf-btn gg-pin-load">Pin from my portfolio (up to 3)</button>
        <button type="button" class="primary-btn gg-comment-send">Comment</button>
      </div></div>`;
}

async function loadAttach(sheet, sel, max, itemsOnly) {
  const box = sheet.body.querySelector(sel);
  if (!box) return;
  box.innerHTML = '<div class="md-skel"></div>';
  try {
    const d = await api.getPortfolio(myUid());
    const rows = d.items.map((i) => `<label class="gg-pick"><input type="checkbox" class="gg-att" data-kind="item" value="${esc(i.id)}"> ${esc(i.title)}</label>`)
      .concat(itemsOnly ? [] : d.credentials.map((c) => `<label class="gg-pick"><input type="checkbox" class="gg-att" data-kind="cred" value="${esc(c.id)}"> ${esc(c.title)} (credential)</label>`));
    box.innerHTML = rows.length ? rows.join("") : '<div class="md-muted">Nothing in your portfolio yet. Add some from your profile.</div>';
    if (!box._wired) {
      box._wired = true;
      box.addEventListener("change", (e) => {
        if (box.querySelectorAll(".gg-att:checked").length > max) {
          e.target.checked = false;
          alert(`You can attach up to ${max}.`);
        }
      });
    }
  } catch (e) {
    box.innerHTML = `<div class="match-data-error">${esc(e.message)}</div>`;
  }
}

async function openJob(id, onChange) {
  const sheet = openSheet({ title: "Job", html: SKEL });
  let d = null;

  async function load() {
    try {
      d = await api.getJob(id);
      if (!sheet.isOpen()) return;
      sheet.setTitle(d.job.kind === "status" ? "Vacancy status" : "Job");
      sheet.setHtml(detailHtml(d));
    } catch (e) {
      if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    }
    if (onChange) onChange();
  }
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);
  const picked = (sel) => [...sheet.body.querySelectorAll(`${sel} .gg-att:checked`)];

  async function sendBid() {
    const proposal = q("proposal").value.trim();
    if (proposal.length < 10) { alert("Write at least 10 characters."); return; }
    const picks = picked(".gg-attach-list");
    await api.bidJob(id, {
      proposal, rate_text: q("rate").value.trim() || null,
      item_ids: picks.filter((p) => p.dataset.kind === "item").map((p) => p.value),
      cred_ids: picks.filter((p) => p.dataset.kind === "cred").map((p) => p.value),
    });
    await load();
  }

  async function sendComment() {
    const content = q("comment").value.trim();
    if (!content) { alert("Write something first."); return; }
    await api.commentJob(id, { content, item_ids: picked(".gg-pin-list").map((p) => p.value) });
    await load();
  }

  async function kliqueAction() {
    const k = d.poster_klique;
    if (k === "accepted") {
      showTab("chats");
      alert("You're Kliqued with the poster. Open your Kliques tab to message them about this post.");
    } else if (k === "none") {
      await api.kliqueRequest(d.job.poster_uid);
      alert("Klique request sent. Once it's accepted you can chat about this post.");
      await load();
    } else if (k === "pending_out") {
      alert("Your Klique request is waiting for them to accept.");
    } else if (k === "pending_in") {
      alert("They sent you a Klique request. Accept it in your Kliques tab.");
    }
  }

  sheet.body.addEventListener("click", async (e) => {
    const t = e.target;
    try {
      if (t.closest(".gg-setstate")) { await api.setJobState(id, q("state").value); await load(); return; }
      const ba = t.closest("[data-bidact]");
      if (ba) { await api.setBidStatus(id, ba.dataset.bid, ba.dataset.bidact); await load(); return; }
      if (t.closest(".gg-withdraw")) { if (confirm("Withdraw your bid?")) { await api.withdrawBid(id); await load(); } return; }
      if (t.closest(".gg-attach-load")) { loadAttach(sheet, ".gg-attach-list", 5, false); return; }
      if (t.closest(".gg-bid-send")) { await sendBid(); return; }
      if (t.closest(".gg-pin-load")) { loadAttach(sheet, ".gg-pin-list", 3, true); return; }
      if (t.closest(".gg-comment-send")) { await sendComment(); return; }
      const cp = t.closest(".gg-cpin");
      if (cp) { await api.pinJobComment(id, cp.dataset.c); await load(); return; }
      const cd = t.closest(".gg-cdel");
      if (cd) { if (confirm("Delete this comment?")) { await api.deleteJobComment(id, cd.dataset.c); await load(); } return; }
      if (t.closest(".gg-klique")) { await kliqueAction(); }
    } catch (err) {
      alert(err.message || "Couldn't do that");
    }
  });

  await load();
}

/* -------------------------------- startup -------------------------------- */

function start() {
  // Capture phase: replace the old "coming soon" alert on the Gig button.
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target.closest("#btn-open-gig") : null;
    if (!t) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    openGigsHub();
  }, true);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);

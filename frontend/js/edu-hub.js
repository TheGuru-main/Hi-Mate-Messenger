// Edu study hub (E1): streak, weekly minutes, exam countdown, subjects/courses with topic progress, deadlines, study log.
import { api } from "./api.js";
import { openSheet } from "./sheet.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const fmt = (n) => Number(n || 0).toLocaleString();
const SKEL = '<div class="md-skel"></div><div class="md-skel"></div>';
const STATUS = ["todo", "learning", "revised", "mastered"];
const STATUS_TXT = { todo: "To do", learning: "Learning", revised: "Revised", mastered: "Mastered" };
const STATUS_ICON = { todo: "○", learning: "◔", revised: "◑", mastered: "●" };
const KIND_TXT = { exam: "Exam", test: "Test", assignment: "Assignment", project: "Project" };

let hub = null;
let data = null;

function localToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function daysFromToday(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - localToday()) / 86400000);
}
function dueLabel(iso) {
  const n = daysFromToday(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

/* ---------------------------------- hub ---------------------------------- */

const cell = (label, value) =>
  `<div class="ps-cell"><div class="ps-val">${esc(value)}</div><div class="ps-lab">${esc(label)}</div></div>`;

function courseCard(c) {
  const meta = [c.kind === "course" ? "Course" : "Subject", c.code, c.credit_units ? `${c.credit_units} units` : ""].filter(Boolean).map(esc).join(" · ");
  return `<div class="lv-card edu-course" data-id="${esc(c.id)}">
    <div class="lv-card-top"><span>${meta}</span><span>${fmt(c.minutes_week)} min this week</span></div>
    <div class="lv-title">${esc(c.name)}</div>
    <div class="eco-track edu-track"><div class="eco-fill" style="width:${c.progress}%"></div></div>
    <div class="lv-sub">${c.topics ? `${c.mastered}/${c.topics} mastered · ${c.progress}%` : "Add topics to track your progress"}</div>
  </div>`;
}

function taskRow(t) {
  return `<div class="eco-row edu-task" data-id="${esc(t.id)}">
    <span class="${t.done ? "edu-done" : ""}">${t.done ? "☑" : "☐"} ${esc(t.title)} <small>(${esc(KIND_TXT[t.kind] || t.kind)}${t.course ? " · " + esc(t.course) : ""})</small></span>
    <b>${esc(dueLabel(t.due))}</b></div>`;
}

function hubHtml(d) {
  const ex = d.next_exam;
  const pct = Math.min(100, Math.round((d.week.minutes / d.week.goal) * 100));
  return `
    <div class="section-title">Study hub</div>
    <div class="ps-grid">
      ${cell(`Day streak${d.streak.best > d.streak.current ? ` (best ${d.streak.best})` : ""}`, `🔥 ${d.streak.current}`)}
      ${cell("Minutes this week", `${fmt(d.week.minutes)}`)}
      ${cell(ex ? ex.title.slice(0, 14) : "Next exam", ex ? `${Math.max(0, daysFromToday(ex.due))}d` : "—")}
    </div>
    <div class="eco-track"><div class="eco-fill" style="width:${pct}%"></div></div>
    <div class="ps-note">${d.streak.today_done ? "Studied today. Nice." : "Log a session today to keep your streak."} Weekly goal: ${fmt(d.week.goal)} minutes.</div>
    <div class="edu-actions">
      <button type="button" class="primary-btn edu-add-course">＋ Add a subject or course</button>
      <button type="button" class="pf-btn edu-add-task">＋ Add an exam or deadline</button>
      <button type="button" class="pf-btn edu-log">Log a study session</button>
    </div>
    ${d.due_soon.length ? `<div class="section-title">Due soon</div>${d.due_soon.map(taskRow).join("")}` : ""}
    <div class="section-title">My subjects and courses</div>
    ${d.courses.length ? d.courses.map(courseCard).join("") : '<div class="ps-note">Nothing yet. Add your first subject and its topics.</div>'}`;
}

function ensureHub() {
  if (hub && hub.isConnected) return hub;
  const page = document.getElementById("edu-page");
  if (!page) return null;
  hub = document.createElement("div");
  hub.id = "edu-hub";
  hub.className = "form-container";
  const first = page.querySelector(".form-container");
  if (first) first.before(hub);
  else page.appendChild(hub);
  hub.addEventListener("click", onHubClick);
  return hub;
}

async function loadHub() {
  const el = ensureHub();
  if (!el) return;
  if (!data) el.innerHTML = SKEL;
  try {
    data = await api.getEduOverview();
    el.innerHTML = hubHtml(data);
  } catch (e) {
    if (!data) el.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
  }
}

function onHubClick(e) {
  const t = e.target;
  if (t.closest(".edu-add-course")) { openCourseForm(); return; }
  if (t.closest(".edu-add-task")) { openTaskForm(null); return; }
  if (t.closest(".edu-log")) { openLogForm(null); return; }
  const task = t.closest(".edu-task");
  if (task) { api.toggleEduTask(task.dataset.id).then(loadHub).catch((err) => alert(err.message)); return; }
  const c = t.closest(".edu-course");
  if (c) openCourse(c.dataset.id);
}

/* --------------------------------- forms --------------------------------- */

function openCourseForm() {
  const sheet = openSheet({ title: "Add a subject or course", html: `
    <div class="pf-form">
      <label>Name</label>
      <input class="input-box" data-f="name" maxlength="80" placeholder="e.g. Mathematics, or MTH 101">
      <label>Code <span class="optional-tag">optional</span></label>
      <input class="input-box" data-f="code" maxlength="20">
      <label>Type</label>
      <select class="input-box" data-f="kind"><option value="subject">Subject (school)</option><option value="course">Course (university or college)</option></select>
      <label>Credit units <span class="optional-tag">optional</span></label>
      <input class="input-box" data-f="units" inputmode="numeric" maxlength="2">
      <label>Topics <span class="optional-tag">one per line, optional</span></label>
      <textarea class="input-box" data-f="topics" rows="6" placeholder="Algebra&#10;Trigonometry&#10;Mensuration"></textarea>
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Save</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);
  q("save").addEventListener("click", async () => {
    const name = q("name").value.trim();
    if (!name) { q("err").textContent = "Add a name."; return; }
    q("save").disabled = true;
    try {
      await api.createEduCourse({
        name, code: q("code").value.trim() || null, kind: q("kind").value,
        credit_units: parseInt(q("units").value, 10) || null,
        topics: q("topics").value.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      sheet.close();
      loadHub();
    } catch (e) {
      q("err").textContent = e.message || "Couldn't save.";
      q("save").disabled = false;
    }
  });
}

function courseOptions(selected) {
  return '<option value="">No subject</option>' +
    ((data && data.courses) || []).map((c) => `<option value="${esc(c.id)}"${c.id === selected ? " selected" : ""}>${esc(c.name)}</option>`).join("");
}

function openTaskForm(courseId, onDone) {
  const sheet = openSheet({ title: "Add an exam or deadline", html: `
    <div class="pf-form">
      <label>What is it?</label>
      <input class="input-box" data-f="title" maxlength="120" placeholder="e.g. WAEC Mathematics, or Chemistry test">
      <label>Type</label>
      <select class="input-box" data-f="kind">${Object.entries(KIND_TXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <label>Date</label>
      <input class="input-box" data-f="due" type="date">
      <label>Subject <span class="optional-tag">optional</span></label>
      <select class="input-box" data-f="course">${courseOptions(courseId)}</select>
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Save</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);
  q("save").addEventListener("click", async () => {
    const title = q("title").value.trim();
    if (!title || !q("due").value) { q("err").textContent = "Add a name and a date."; return; }
    q("save").disabled = true;
    try {
      await api.createEduTask({ title, kind: q("kind").value, due: q("due").value, course_id: q("course").value || null });
      sheet.close();
      loadHub();
      if (onDone) onDone();
    } catch (e) {
      q("err").textContent = e.message || "Couldn't save.";
      q("save").disabled = false;
    }
  });
}

function openLogForm(courseId, onDone) {
  const sheet = openSheet({ title: "Log a study session", html: `
    <div class="pf-form">
      <label>Subject <span class="optional-tag">optional</span></label>
      <select class="input-box" data-f="course">${courseOptions(courseId)}</select>
      <label>Topic <span class="optional-tag">optional</span></label>
      <select class="input-box" data-f="topic"><option value="">No topic</option></select>
      <label>Minutes studied <span class="optional-tag">optional</span></label>
      <input class="input-box" data-f="minutes" inputmode="numeric" maxlength="3" placeholder="30">
      <label>What did you learn or improve?</label>
      <textarea class="input-box" data-f="note" rows="4" maxlength="1000"></textarea>
      <div class="pf-err" data-f="err"></div>
      <button type="button" class="primary-btn" data-f="save">Save session</button>
    </div>` });
  const q = (n) => sheet.body.querySelector(`[data-f="${n}"]`);

  async function loadTopics() {
    const id = q("course").value;
    q("topic").innerHTML = '<option value="">No topic</option>';
    if (!id) return;
    try {
      const d = await api.getEduCourse(id);
      q("topic").innerHTML = '<option value="">No topic</option>' +
        d.topics.map((t) => `<option value="${esc(t.id)}">${esc(t.title)} (${esc(STATUS_TXT[t.status])})</option>`).join("");
    } catch (e) { /* leave empty */ }
  }
  q("course").addEventListener("change", loadTopics);
  loadTopics();

  q("save").addEventListener("click", async () => {
    const note = q("note").value.trim();
    if (!note) { q("err").textContent = "Write what you studied."; return; }
    q("save").disabled = true;
    try {
      await api.logEduSession({
        content: note, minutes: parseInt(q("minutes").value, 10) || null,
        course_id: q("course").value || null, topic_id: q("topic").value || null,
      });
      sheet.close();
      loadHub();
      if (onDone) onDone();
    } catch (e) {
      q("err").textContent = e.message || "Couldn't save.";
      q("save").disabled = false;
    }
  });
}

/* ------------------------------ subject sheet ------------------------------ */

function courseHtml(d) {
  const c = d.course;
  const meta = [c.kind === "course" ? "Course" : "Subject", c.code, c.credit_units ? `${c.credit_units} units` : ""].filter(Boolean).map(esc).join(" · ");
  const counts = STATUS.map((s) => `${STATUS_TXT[s]} ${d.counts[s] || 0}`).join(" · ");
  const topics = d.topics.map((t) => `<div class="edu-topic" data-t="${esc(t.id)}">
      <span>${esc(t.title)}</span>
      <button type="button" class="edu-status" data-s="${esc(t.status)}">${STATUS_ICON[t.status] || "○"} ${esc(STATUS_TXT[t.status] || t.status)}</button>
      <button type="button" class="edu-x" title="Remove topic">✕</button></div>`).join("");
  const tasks = d.tasks.map((t) => `<div class="eco-row"><span class="edu-ctask ${t.done ? "edu-done" : ""}" data-id="${esc(t.id)}">${t.done ? "☑" : "☐"} ${esc(t.title)} <small>(${esc(KIND_TXT[t.kind] || t.kind)})</small></span>
      <b>${esc(dueLabel(t.due))} <button type="button" class="edu-x edu-tdel" data-id="${esc(t.id)}">✕</button></b></div>`).join("");
  const recent = d.recent.map((r) => `<div class="eco-row"><span>${esc(String(r.content).slice(0, 60))}</span><b>${r.minutes ? r.minutes + " min" : ""}</b></div>`).join("");
  return `
    <div class="gg-detail">
      <div class="lv-sub">${meta}</div>
      <div class="eco-track edu-track"><div class="eco-fill" style="width:${d.progress}%"></div></div>
      <div class="lv-sub">${d.progress}% · ${esc(counts)}</div>
      <div class="lv-sub">${fmt(d.minutes_total)} minutes logged in total</div>
    </div>
    <div class="edu-actions" style="padding:0 12px">
      <button type="button" class="primary-btn edu-clog">Log a study session</button>
      <button type="button" class="pf-btn edu-ctaskadd">＋ Add an exam or deadline</button>
    </div>
    <div class="md-block"><div class="md-title">Topics<span class="md-sub">tap a status to move it on</span></div>
      ${topics || '<div class="md-muted md-pad">No topics yet.</div>'}
      <div class="pf-form">
        <textarea class="input-box" data-f="newtopics" rows="3" placeholder="Add topics, one per line"></textarea>
        <button type="button" class="pf-btn edu-addtopics">Add topics</button>
      </div></div>
    ${tasks ? `<div class="md-block"><div class="md-title">Exams and deadlines</div>${tasks}</div>` : ""}
    ${recent ? `<div class="md-block"><div class="md-title">Recent sessions</div>${recent}</div>` : ""}
    <div class="md-pad"><button type="button" class="pf-btn edu-cdel">Delete this subject</button></div>`;
}

async function openCourse(id) {
  const sheet = openSheet({ title: "Subject", html: SKEL });
  let d = null;

  async function load() {
    try {
      d = await api.getEduCourse(id);
      if (!sheet.isOpen()) return;
      sheet.setTitle(d.course.name);
      sheet.setHtml(courseHtml(d));
    } catch (e) {
      if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    }
    loadHub();
  }

  sheet.body.addEventListener("click", async (e) => {
    const t = e.target;
    try {
      const st = t.closest(".edu-status");
      if (st) {
        const next = STATUS[(STATUS.indexOf(st.dataset.s) + 1) % STATUS.length];
        await api.setEduTopic(st.closest(".edu-topic").dataset.t, next);
        await load();
        return;
      }
      const tdel = t.closest(".edu-tdel");
      if (tdel) { await api.deleteEduTask(tdel.dataset.id); await load(); return; }
      const ctask = t.closest(".edu-ctask");
      if (ctask) { await api.toggleEduTask(ctask.dataset.id); await load(); return; }
      if (t.closest(".edu-x")) {
        if (confirm("Remove this topic?")) { await api.deleteEduTopic(t.closest(".edu-topic").dataset.t); await load(); }
        return;
      }
      if (t.closest(".edu-addtopics")) {
        const titles = sheet.body.querySelector('[data-f="newtopics"]').value.split("\n").map((s) => s.trim()).filter(Boolean);
        if (!titles.length) return;
        await api.addEduTopics(id, titles);
        await load();
        return;
      }
      if (t.closest(".edu-clog")) { openLogForm(id, load); return; }
      if (t.closest(".edu-ctaskadd")) { openTaskForm(id, load); return; }
      if (t.closest(".edu-cdel")) {
        if (confirm("Delete this subject, its topics and its deadlines?")) {
          await api.deleteEduCourse(id);
          sheet.close();
          loadHub();
        }
      }
    } catch (err) {
      alert(err.message || "Couldn't do that");
    }
  });

  await load();
}

/* -------------------------------- startup -------------------------------- */

function start() {
  const open = document.getElementById("btn-open-edu");
  if (open) open.addEventListener("click", loadHub);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);

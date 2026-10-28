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
      <button type="button" class="pf-btn edu-practice">Practice questions</button>
      <button type="button" class="pf-btn edu-week-goal">Set weekly goal</button>
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
  if (t.closest(".edu-practice")) { openPracticeForm(); return; }
  if (t.closest(".edu-week-goal")) { openWeeklyGoalForm(); return; }
  const task = t.closest(".edu-task");
  if (task) { api.toggleEduTask(task.dataset.id).then(loadHub).catch((err) => alert(err.message)); return; }
  const c = t.closest(".edu-course");
  if (c) openCourse(c.dataset.id);
}

/* --------------------------------- forms --------------------------------- */

function openWeeklyGoalForm() {
  const current = Number(data?.week?.goal || 150);
  const sheet = openSheet({
    title: "Weekly study goal",
    html: `
      <div class="pf-form">
        <label>Study minutes per week</label>
        <input class="input-box" data-f="goal" type="number"
          min="30" max="10080" step="15" value="${current}">
        <div class="pf-err" data-f="err"></div>
        <button type="button" class="primary-btn" data-f="save">Save goal</button>
      </div>`
  });
  const q = (name) => sheet.body.querySelector(`[data-f="${name}"]`);
  q("save").addEventListener("click", async () => {
    const minutes = Number(q("goal").value);
    if (!Number.isInteger(minutes) || minutes < 30 || minutes > 10080) {
      q("err").textContent = "Choose between 30 and 10,080 minutes.";
      return;
    }
    q("save").disabled = true;
    try {
      await api.setEduWeeklyGoal(minutes);
      data = null;
      sheet.close();
      await loadHub();
    } catch (e) {
      q("err").textContent = e.message || "Couldn't save the goal.";
      q("save").disabled = false;
    }
  });
}


function openPracticeForm() {
  const sheet = openSheet({
    title: "Question practice",
    html: `
      <div class="pf-form">
        <label>Filter by subject</label>
        <select class="input-box" data-f="filter-course">${courseOptions("")}</select>
        <button type="button" class="pf-btn" data-f="load">Load questions</button>
        <div class="ps-note" data-f="stats">Loading practice stats…</div>
        <div data-f="questions"></div>
        <details style="margin-top:16px">
          <summary>Add a question</summary>
          <div class="pf-form">
            <label>Subject</label>
            <select class="input-box" data-f="course">${courseOptions("")}</select>
            <label>Topic <span class="optional-tag">optional</span></label>
            <select class="input-box" data-f="topic"><option value="">No topic</option></select>
            <label>Question</label>
            <textarea class="input-box" data-f="question" rows="3" maxlength="3000"></textarea>
            <label>Option A</label><input class="input-box" data-f="a" maxlength="500">
            <label>Option B</label><input class="input-box" data-f="b" maxlength="500">
            <label>Option C</label><input class="input-box" data-f="c" maxlength="500">
            <label>Option D</label><input class="input-box" data-f="d" maxlength="500">
            <label>Correct option</label>
            <select class="input-box" data-f="correct">
              <option value="A">A</option><option value="B">B</option>
              <option value="C">C</option><option value="D">D</option>
            </select>
            <label>Explanation <span class="optional-tag">optional</span></label>
            <textarea class="input-box" data-f="explanation" rows="3" maxlength="3000"></textarea>
            <div class="pf-err" data-f="err"></div>
            <button type="button" class="primary-btn" data-f="save">Save question</button>
          </div>
        </details>
      </div>`
  });

  const q = (name) => sheet.body.querySelector(`[data-f="${name}"]`);
  let answered = new Set();

  async function loadStats() {
    try {
      const stats = await api.getEduPracticeStats();
      q("stats").textContent =
        `Attempts: ${stats.attempts} · Correct: ${stats.correct} · Accuracy: ${stats.accuracy}%`;
    } catch (_) {
      q("stats").textContent = "Practice statistics unavailable.";
    }
  }

  async function loadQuestions() {
    q("questions").innerHTML = '<div class="ps-note">Loading questions…</div>';
    answered = new Set();

    try {
      const questions = await api.getEduQuestions({
        course_id: q("filter-course").value || undefined,
        limit: 30
      });

      if (!questions.length) {
        q("questions").innerHTML =
          '<div class="ps-note">No questions yet. Add your first question below.</div>';
        return;
      }

      q("questions").innerHTML = questions.map((item, index) => `
        <div class="md-block" data-question="${esc(item.id)}">
          <div class="md-title">Question ${index + 1}</div>
          <p>${esc(item.question)}</p>
          ${Object.entries(item.options).map(([letter, text]) => `
            <button type="button" class="pf-btn edu-answer"
              data-qid="${esc(item.id)}" data-answer="${letter}"
              style="display:block;width:100%;text-align:left;margin:6px 0">
              ${letter}. ${esc(text)}
            </button>`).join("")}
          <div class="ps-note" data-f="feedback"></div>
        </div>`).join("");
    } catch (error) {
      q("questions").innerHTML = `<div class="error-text">${esc(error.message)}</div>`;
    }
  }

  async function loadTopics() {
    const id = q("course").value;
    q("topic").innerHTML = '<option value="">No topic</option>';
    if (!id) return;

    try {
      const course = await api.getEduCourse(id);
      q("topic").innerHTML += (course.topics || []).map((topic) =>
        `<option value="${esc(topic.id)}">${esc(topic.title)}</option>`
      ).join("");
    } catch (_) {}
  }

  q("course").addEventListener("change", loadTopics);
  q("load").addEventListener("click", loadQuestions);

  q("save").addEventListener("click", async () => {
    const question = q("question").value.trim();
    const options = ["a", "b", "c", "d"].map((key) => q(key).value.trim());

    if (question.length < 3 || options.some((value) => !value)) {
      q("err").textContent = "Enter a question and all four options.";
      return;
    }

    q("save").disabled = true;
    q("err").textContent = "";

    try {
      await api.createEduQuestion({
        question,
        option_a: options[0],
        option_b: options[1],
        option_c: options[2],
        option_d: options[3],
        correct_option: q("correct").value,
        explanation: q("explanation").value.trim() || null,
        course_id: q("course").value || null,
        topic_id: q("topic").value || null
      });

      q("question").value = "";
      ["a", "b", "c", "d"].forEach((key) => { q(key).value = ""; });
      q("explanation").value = "";
      q("err").textContent = "Question saved.";
      await loadQuestions();
      await loadStats();
    } catch (error) {
      q("err").textContent = error.message || "Couldn't save the question.";
    } finally {
      q("save").disabled = false;
    }
  });

  sheet.body.addEventListener("click", async (event) => {
    const button = event.target.closest(".edu-answer");
    if (!button || answered.has(button.dataset.qid)) return;

    const card = button.closest("[data-question]");
    const feedback = card.querySelector('[data-f="feedback"]');
    card.querySelectorAll(".edu-answer").forEach((item) => { item.disabled = true; });

    try {
      const result = await api.answerEduQuestion(button.dataset.qid, button.dataset.answer);
      answered.add(button.dataset.qid);
      feedback.textContent =
        `${result.is_correct ? "Correct!" : "Not quite."} Correct answer: ${result.correct_option}.` +
        (result.explanation ? ` ${result.explanation}` : "");
      await loadStats();
    } catch (error) {
      card.querySelectorAll(".edu-answer").forEach((item) => { item.disabled = false; });
      feedback.textContent = error.message || "Couldn't submit the answer.";
    }
  });

  loadStats();
  loadQuestions();
}

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

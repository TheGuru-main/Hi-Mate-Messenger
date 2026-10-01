import { api, getCachedUser } from "./api.js";
import { showPage } from "./router.js";

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

async function loadEduSetup() {
    try {
        const me = await api.getMe();
        document.getElementById("edu-class-input").value = me.edu_class || "";
        document.getElementById("edu-stage-input").value = me.edu_stage || "";
        document.getElementById("edu-school-input").value = me.edu_school_name || "";
        document.getElementById("edu-student-id-input").value = me.edu_student_id || "";
        document.getElementById("edu-link-id-input").value = me.edu_school_link_id || "";
        document.getElementById("edu-display-name-input").value = me.edu_display_name || "";
    } catch (e) { /* ignore */ }
}

async function loadJournal() {
    const list = document.getElementById("edu-journal-list");
    list.innerHTML = '<div class="section-title">Loading…</div>';
    try {
        const entries = await api.getEduJournal();
        list.innerHTML = entries.length ? "" : '<div class="section-title">No entries yet.</div>';
        entries.forEach(e => {
            const div = document.createElement("div");
            div.className = "card";
            div.innerHTML = `
              <div class="content">${escapeHtml(e.content)}</div>
              <div class="post-meta">${new Date(e.created_at).toLocaleString()}</div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        list.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
}

export function initEdu() {
    const openBtn = document.getElementById("btn-open-edu");
    if (openBtn) openBtn.addEventListener("click", () => { showPage("edu-page"); loadEduSetup(); loadJournal(); });

    const backBtn = document.getElementById("btn-back-from-edu");
    if (backBtn) backBtn.addEventListener("click", () => showPage("home"));

    const saveBtn = document.getElementById("edu-save-btn");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const errEl = document.getElementById("edu-setup-error");
            try {
                await api.updateMe({
                    edu_class: document.getElementById("edu-class-input").value.trim(),
                    edu_stage: document.getElementById("edu-stage-input").value.trim(),
                    edu_school_name: document.getElementById("edu-school-input").value.trim(),
                    edu_student_id: document.getElementById("edu-student-id-input").value.trim(),
                    edu_school_link_id: document.getElementById("edu-link-id-input").value.trim(),
                    edu_display_name: document.getElementById("edu-display-name-input").value.trim(),
                });
                errEl.textContent = "Saved.";
            } catch (e) {
                errEl.textContent = e.message;
            }
        });
    }

    const addBtn = document.getElementById("edu-journal-add-btn");
    if (addBtn) {
        addBtn.addEventListener("click", async () => {
            const input = document.getElementById("edu-journal-input");
            const content = input.value.trim();
            if (!content) return;
            try {
                await api.createEduJournalEntry(content);
                input.value = "";
                loadJournal();
            } catch (e) {
                alert(e.message);
            }
        });
    }
}

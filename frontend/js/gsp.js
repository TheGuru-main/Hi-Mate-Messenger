// ==========================================
// HI-MATE MESSENGER
// gsp.js — CLIENT-SIDE PREVIEW ONLY.
// The real L/S/C/start_row are always computed server-side (see the
// backend's app/services/placement.py) and are NEVER trusted from the
// client. This file exists purely to show a fun live preview during
// signup — it has no authority and nothing here is sent to the API.
// ==========================================

function previewComputeL(name) {
    return (name || "").replace(/\s+/g, "").length;
}

function previewComputeC(name) {
    const cleaned = (name || "").trim();
    if (!cleaned) return 0;
    const first = cleaned[0].toUpperCase();
    if (first >= "A" && first <= "Z") return first.charCodeAt(0) - 65;
    return 0;
}

function previewComputeS(uid) {
    return (uid || "").replace(/\D/g, "").split("").reduce((sum, d) => sum + Number(d), 0);
}

function previewStartRow(L, S) {
    if (L + S <= 0) return 1;
    return ((L + S - 1) % 64) + 1;
}

function updateGspPreview() {
    const nameEl = document.getElementById("username");
    const phoneEl = document.getElementById("phone");
    const codeEl = document.getElementById("country-code");
    const previewEl = document.getElementById("gsp-preview");
    if (!nameEl || !previewEl) return;

    const name = nameEl.value;
    const uid = (codeEl ? cleanDialCodeSafe(codeEl.value) : "") + (phoneEl ? phoneEl.value.replace(/\D/g, "") : "");

    const L = previewComputeL(name);
    const S = previewComputeS(uid);
    const C = previewComputeC(name);
    const row = previewStartRow(L, S);

    previewEl.textContent = name
        ? `Preview cell: row ${row} · col ${C} (recalculated for real on the server)`
        : "";
}

function cleanDialCodeSafe(iso) {
    // countries.js stores dial codes on the country object, not raw on the select —
    // best-effort lookup, falls back to empty if not found (preview is non-critical).
    if (typeof getCountryByISO !== "function") return "";
    const country = getCountryByISO(iso);
    return country ? country.dial_code.replace("+", "") : "";
}

function initGspPreview() {
    const nameEl = document.getElementById("username");
    const phoneEl = document.getElementById("phone");
    if (nameEl) nameEl.addEventListener("input", updateGspPreview);
    if (phoneEl) phoneEl.addEventListener("input", updateGspPreview);
}

window.addEventListener("load", initGspPreview);

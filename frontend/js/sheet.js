// Reusable full-screen slide-up sheet (match details, club profile, ...).
// Self-contained: no dependency on the router or on index.html structure.

function themeColors() {
  let bg = "", fg = "";
  try {
    const cs = getComputedStyle(document.body);
    bg = cs.backgroundColor;
    fg = cs.color;
  } catch (e) { /* ignore */ }
  const transparent = !bg || bg === "transparent" || /rgba\(.*,\s*0\)$/.test(bg);
  if (transparent) {
    const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    bg = dark ? "#0f1115" : "#ffffff";
    fg = dark ? "#f2f4f8" : "#111111";
  }
  return { bg, fg };
}

export function openSheet({ title = "", html = "", onClose } = {}) {
  const { bg, fg } = themeColors();
  const el = document.createElement("div");
  el.className = "hm-sheet";
  el.innerHTML = `
    <div class="hm-sheet-panel">
      <div class="hm-sheet-bar">
        <button type="button" class="hm-sheet-close" aria-label="Close">‹</button>
        <div class="hm-sheet-title"></div>
      </div>
      <div class="hm-sheet-body"></div>
    </div>`;
  const panel = el.querySelector(".hm-sheet-panel");
  panel.style.background = bg;
  panel.style.color = fg;
  const titleEl = el.querySelector(".hm-sheet-title");
  const body = el.querySelector(".hm-sheet-body");
  titleEl.textContent = title;
  body.innerHTML = html;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("hm-sheet-open"));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    el.classList.remove("hm-sheet-open");
    setTimeout(() => el.remove(), 180);
    if (onClose) onClose();
  }
  function onKey(event) {
    if (event.key === "Escape") close();
  }
  el.querySelector(".hm-sheet-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  return {
    el, body, close,
    isOpen: () => !closed && el.isConnected,
    setTitle: (t) => { titleEl.textContent = t; },
    setHtml: (h) => { body.innerHTML = h; },
  };
}

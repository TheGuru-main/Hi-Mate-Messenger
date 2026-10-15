// Network alerts + auto-retry: offline banner, "server waking up" notice, repeated-failure alert,
// and automatic retry of GET requests while a cold server wakes up.
const API_RE = /\/v1\//;
const SLOW_MS = 6000;
const FAIL_LIMIT = 2;
const RETRY_DELAYS = [2000, 4000, 8000, 12000, 15000];
const realFetch = window.fetch.bind(window);

let seq = 0;
let fails = 0;
let mode = null;
let lastOrigin = location.origin;
let probeTimer = null;
let hideTimer = null;
const slow = new Set();
const timers = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function banner() {
  let b = document.getElementById("net-banner");
  if (b) return b;
  b = document.createElement("div");
  b.id = "net-banner";
  b.className = "net-banner";
  b.setAttribute("role", "status");
  b.setAttribute("aria-live", "polite");
  b.innerHTML = '<span class="net-text"></span><button type="button" class="net-retry">Retry</button>';
  b.querySelector(".net-retry").addEventListener("click", probe);
  document.body.appendChild(b);
  return b;
}

function show(kind, text, retry) {
  clearTimeout(hideTimer);
  mode = kind;
  const b = banner();
  b.className = "net-banner show " + (kind === "waking" ? "net-warn" : kind === "ok" ? "net-ok" : "net-bad");
  b.querySelector(".net-text").textContent = text;
  b.querySelector(".net-retry").style.display = retry ? "" : "none";
}

function hide() {
  mode = null;
  const b = document.getElementById("net-banner");
  if (b) b.classList.remove("show");
}

function recovered() {
  clearInterval(probeTimer);
  probeTimer = null;
  fails = 0;
  if (mode === "offline" || mode === "unreachable") {
    show("ok", "Back online", false);
    hideTimer = setTimeout(hide, 2200);
    document.dispatchEvent(new CustomEvent("hm:net-recovered"));
  }
}

function probe() {
  return realFetch(lastOrigin + "/", { mode: "no-cors", cache: "no-store" })
    .then(() => { recovered(); return true; })
    .catch(() => false);
}

function startProbe() {
  if (!probeTimer) probeTimer = setInterval(probe, 6000);
}

function finish(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  slow.delete(id);
  if (mode === "waking" && !slow.size) hide();
}

function noteOk() {
  fails = 0;
  if (mode === "unreachable" || mode === "offline") recovered();
}

function noteFail() {
  fails += 1;

  if (!navigator.onLine) {
    show("offline", "No internet connection. Showing what's saved on your phone.", true);
    startProbe();
  } else if (fails >= FAIL_LIMIT) {
    show("unreachable", "Can't reach Hi-Mate right now. Retrying…", true);
    startProbe();
  }
}

async function send(input, init, safe, id) {
  let n = 0;

  for (;;) {
    try {
      const res = await realFetch(input, init);

      if (res.status >= 502 && res.status <= 504) {
        noteFail();

        if (safe && n < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[n++]);
          continue;
        }
      } else {
        noteOk();
      }

      finish(id);
      return res;
    } catch (err) {
      if (err && err.name === "AbortError") {
        finish(id);
        throw err;
      }

      noteFail();

      if (safe && navigator.onLine && n < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[n++]);
        continue;
      }

      finish(id);
      throw err;
    }
  }
}

window.fetch = function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || "";

  if (!API_RE.test(url)) return realFetch(input, init);

  try { lastOrigin = new URL(url, location.href).origin; } catch (e) { /* ignore */ }

  const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
  const safe = method === "GET" || method === "HEAD";
  const id = ++seq;

  timers.set(id, setTimeout(() => {
    if (!timers.has(id)) return;
    slow.add(id);
    if (navigator.onLine && mode !== "unreachable") {
      show("waking", "Hi-Mate is waking up… the first load can take up to a minute.", false);
    }
  }, SLOW_MS));

  return send(input, init, safe, id);
};

window.addEventListener("offline", () => {
  show("offline", "No internet connection. Showing what's saved on your phone.", true);
  startProbe();
});

window.addEventListener("online", () => { probe(); });

if (!navigator.onLine) window.dispatchEvent(new Event("offline"));

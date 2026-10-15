// Lazy video: feed videos render with data-src and cost no data until they near the viewport.
const conn = navigator.connection || {};
const slowNet = !!(conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""));

function attach(v) {
  const src = v.dataset.src;
  if (!src || v.getAttribute("src")) return;
  v.preload = "metadata";
  v.src = src;
  v.load();
}

const io = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          attach(e.target);
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: slowNet ? "200px 0px" : "900px 0px" })
  : null;

function watch(v) {
  if (v._lazy) return;
  v._lazy = true;
  if (io) io.observe(v);
  else attach(v);
}

function scan(root) {
  if (root.matches && root.matches("video[data-src]")) watch(root);
  if (root.querySelectorAll) root.querySelectorAll("video[data-src]").forEach(watch);
}

function start() {
  scan(document.body);

  new MutationObserver((records) => {
    records.forEach((r) => r.addedNodes.forEach((n) => {
      if (n.nodeType === 1) scan(n);
    }));
  }).observe(document.body, { childList: true, subtree: true });

  // Tapping play before the source is attached must still work.
  document.addEventListener("click", (e) => {
    const box = e.target.closest ? e.target.closest(".himate-video") : null;
    if (!box) return;
    const v = box.querySelector("video[data-src]");
    if (v) attach(v);
  }, true);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);

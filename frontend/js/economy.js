// Economy: compact strip (Sandclock + Byflint pills) and their screens.
// The Sandclock screen is a live, animated hourglass: it fills with a tween, grains fall, and it reacts to new fill.
import { api, getToken } from "./api.js";
import { openSheet } from "./sheet.js";

const NS = "http://www.w3.org/2000/svg";
const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const GLASS = "M18 14 H102 L102 24 L66 98 L66 102 L102 176 L102 186 H18 L18 176 L54 102 L54 98 L18 24 Z";
const SKEL = '<div class="md-skel"></div><div class="md-skel"></div>';

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const fmt = (n) => Number(n || 0).toLocaleString();
const short = (n) => {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1) + "k";
  return String(n);
};
const pctText = (v) => {
  v = Number(v) || 0;
  if (v === 0) return "0%";
  return (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + "%";
};
function untilText(iso) {
  if (!iso) return "—";
  const clean = String(iso).replace(/(\.\d{3})\d+/, "$1");
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(clean) ? clean : clean + "Z");
  const ms = d.getTime() - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "ready now";
  const mins = Math.ceil(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const KIND = {
  checkin: "Daily check-in", like: "Like reward", comment: "Comment reward", share: "Share reward",
  spot_gem: "Spot a Gem", klique_milestone: "Klique milestone", post_video: "Video post", post_voice: "Voice post", post_text: "Text post", gift_sent: "Gift sent", gift_received: "Gift received",
  gig_entry: "Gig entry", gig_payout: "Gig prize", gig_refund: "Gig refund",
};

let strip = null;
let wallet = null;
let sand = null;
let manifest = null;
let live = null;   // the open Sandclock screen, if any

/* ------------------------------ strip ------------------------------ */

function ensureStrip() {
  if (strip && strip.isConnected) return strip;
  const top = document.querySelector("#home .top-bar");
  if (!top) return null;
  strip = document.createElement("div");
  strip.className = "eco-bar hidden";
  strip.innerHTML =
    '<button type="button" class="eco-pill" data-eco="sand"><i class="fa-solid fa-hourglass-half eco-ico"></i><span class="eco-sand-text">—</span></button>' +
    '<button type="button" class="eco-pill" data-eco="coin"><i class="fa-solid fa-coins eco-ico"></i><span class="eco-coin-text">—</span></button>';
  top.after(strip);
  strip.addEventListener("click", (e) => {
    const b = e.target.closest("[data-eco]");
    if (!b) return;
    if (b.dataset.eco === "sand") openSandclock();
    else openByflint();
  });
  return strip;
}

function paint() {
  const s = ensureStrip();
  if (!s || !wallet || !sand) return;
  s.classList.remove("hidden");
  s.querySelector(".eco-sand-text").textContent = `${pctText(sand.fill)}${sand.level ? ` · Lv ${sand.level}` : ""}`;
  s.querySelector('[data-eco="sand"] .eco-ico').style.color = sand.color.hex;
  s.querySelector(".eco-coin-text").textContent =
    `${short(wallet.balance)} B${wallet.pending ? ` (+${short(wallet.pending)})` : ""}`;
}

function pop(sel) {
  if (reduceMotion || !strip) return;
  const el = strip.querySelector(sel);
  if (!el) return;
  el.classList.remove("eco-pop");
  void el.offsetWidth;
  el.classList.add("eco-pop");
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "eco-toast";
  t.textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3200);
}

function react(pw, ps) {
  if (!pw || !ps || !wallet || !sand) return;
  if (wallet.balance + wallet.pending > pw.balance + pw.pending) pop('[data-eco="coin"]');
  const colorUp = sand.color.index !== ps.color.index || sand.level !== ps.level;
  if (sand.fill > ps.fill || colorUp) pop('[data-eco="sand"]');
  if (colorUp) toast(`${ps.color.name} complete → ${sand.color.name}`);
  if (live) live.update(sand, ps);
}

async function refresh() {
  if (!getToken()) return;
  try {
    const [w, sc] = await Promise.all([api.getWallet(), api.getSandclock()]);
    const pw = wallet, ps = sand;
    wallet = w;
    sand = sc;
    paint();
    react(pw, ps);
  } catch (e) { /* keep the last values */ }
}

/* ------------------------------ Byflint screen ------------------------------ */

function cell(label, value) {
  return `<div class="ps-cell"><div class="ps-val">${esc(value)}</div><div class="ps-lab">${esc(label)}</div></div>`;
}

function byflintHtml(w, m, ledger) {
  const c = m.currency;
  const wd = m.gates.withdraw;
  const tfc = w.balance / c.byflint_per_tfc;
  const boost = sand ? sand.boost : 1;
  const pct = (cur, need) => Math.min(100, Math.round((cur / need) * 100));
  const meter = (label, cur, need, shown) => `
    <div class="eco-row"><span>${esc(label)}</span><b>${esc(shown)}</b></div>
    <div class="eco-track"><div class="eco-fill" style="width:${pct(cur, need)}%"></div></div>`;
  const rates = [
    ["Daily check-in", m.checkin.byflint], ["Like", m.rewards.like], ["Comment", m.rewards.comment],
    ["Share", m.rewards.share], ["Spot a Gem", m.rewards.spot_gem], 
  ].map(([l, v]) => `<div class="eco-row"><span>${esc(l)}</span><b>${fmt(v)} B</b></div>`).join("");
  const hist = (ledger || []).map((r) => {
    const label = KIND[r.kind] || r.kind;
    const sign = r.amount > 0 ? "+" : "";
    return `<div class="eco-row"><span>${esc(label)}${r.status === "pending" ? " · pending" : ""}</span><b>${sign}${fmt(r.amount)} B</b></div>`;
  }).join("");
  const reward = Math.floor(m.checkin.byflint * boost);

  return `
    <div class="eco-balance">
      <div class="eco-big">${fmt(w.balance)} <small>B</small></div>
      <div class="eco-sub">Available · ≈ ₦${fmt(w.naira_value)}</div>
    </div>
    <div class="ps-grid">
      ${cell("Pending", `${fmt(w.pending)} B`)}
      ${cell("Releases in", w.pending ? untilText(w.next_release_at) : "—")}
      ${cell("Earning boost", `×${boost}`)}
    </div>
    <div class="md-block">
      <div class="md-title">Daily check-in</div>
      <div class="md-pad">
        <button type="button" class="primary-btn eco-checkin" ${w.checked_in ? "disabled" : ""}>
          ${w.checked_in ? "Checked in today ✓" : `Check in · +${fmt(reward)} B`}
        </button>
        <div class="ps-note">Rewards are held ${esc(m.pending_hours)} hours, then move to Available.</div>
      </div>
    </div>
    <div class="md-block">
      <div class="md-title">How Byflint is valued<span class="md-sub">rules v${esc(m.version)}</span></div>
      <div class="eco-row"><span>1 TFC</span><b>${fmt(c.byflint_per_tfc)} B = ₦${fmt(c.naira_per_tfc)}</b></div>
      <div class="eco-row"><span>₦1</span><b>${fmt(Math.round(1 / c.naira_per_byflint))} B</b></div>
      <div class="eco-row"><span>1,000 B</span><b>₦${fmt(1000 * c.naira_per_byflint)}</b></div>
      <div class="ps-note">Internal rewards only for now. Unlocks outside the app come later.</div>
    </div>
    <div class="md-block">
      <div class="md-title">Base rewards<span class="md-sub">× colour boost</span></div>
      ${rates}
      <div class="ps-note">Comment rewards: up to ${esc(m.caps.comments_per_target_per_day ?? 3)} per account per day. Gifts have their own weights.</div>
    </div>
    ${postRewardsHtml(m)}
    ${kliqueHtml(m, w)}
    <div class="md-block">
      <div class="md-title">Cash-out thresholds<span class="md-sub">locked</span></div>
      ${meter("Balance", tfc, wd.tfc, `${tfc.toFixed(3)} / ${wd.tfc} TFC`)}
      ${meter("Followers", w.followers, wd.followers, `${fmt(w.followers)} / ${fmt(wd.followers)}`)}
      ${meter("Mutual Kliques", w.kliques, wd.mutual_kliques, `${fmt(w.kliques)} / ${fmt(wd.mutual_kliques)}`)}
      <div class="ps-note">Byflints stay inside Hi-Mate until all three are met and cash-out opens.</div>
    </div>
    <div class="md-block">
      <div class="md-title">History</div>
      ${hist || '<div class="md-muted md-pad">Nothing yet. Your first check-in will show here.</div>'}
    </div>`;
}

function postRewardsHtml(m) {
  const pr = m.post_rewards;
  if (!pr) return "";
  const v = pr.video;
  let prev = 0;
  const rows = v.tiers.map((t) => {
    const label = prev === 0 ? `Video up to ${t.max_minutes} min` : `Video ${prev}–${t.max_minutes} min`;
    prev = t.max_minutes;
    return `<div class="eco-row"><span>${esc(label)}</span><b>${fmt(t.byflint)} B</b></div>`;
  }).join("");
  return `
    <div class="md-block">
      <div class="md-title">Post rewards<span class="md-sub">× colour boost</span></div>
      ${rows}
      <div class="eco-row"><span>Voice post</span><b>video reward ÷ ${esc(pr.voice.divisor)}</b></div>
      <div class="eco-row"><span>Text post (images included)</span><b>${fmt(pr.text.byflint)} B</b></div>
      <div class="ps-note">Rewarded each day: up to ${esc(v.cap_per_day)} videos, ${esc(pr.voice.cap_per_day)} voice posts and ${esc(pr.text.cap_per_day)} text posts. Extra posts still publish, they just earn no Byflints.</div>
    </div>`;
}

function kliqueHtml(m, w) {
  const ms = m.klique_milestones || [];
  if (!ms.length) return "";
  const q = w.kliques_qualified ?? 0;
  let prev = 0;
  const rows = ms.map((x) => {
    const pay = x.total - prev;
    prev = x.total;
    return `<div class="eco-row"><span>${fmt(x.at)} Kliques${q >= x.at ? " ✓" : ""}</span><b>+${fmt(pay)} B</b></div>`;
  }).join("");
  const next = ms.find((x) => q < x.at);
  return `
    <div class="md-block">
      <div class="md-title">Klique milestones<span class="md-sub">${fmt(q)} counted</span></div>
      ${rows}
      <div class="ps-note">Kliques don't earn Byflints one by one, only at milestones. Only mutual Kliques with accounts at least ${esc(m.klique_min_account_age_days ?? 7)} days old count.${next ? ` Next: ${fmt(next.at)}.` : ""}</div>
    </div>`;
}

async function openByflint() {
  const sheet = openSheet({ title: "Byflint", html: SKEL });

  async function load() {
    try {
      const [w, m, l] = await Promise.all([
        api.getWallet(),
        manifest ? Promise.resolve(manifest) : api.getManifest(),
        api.getLedger(20),
      ]);
      wallet = w;
      manifest = m;
      paint();
      if (sheet.isOpen()) sheet.setHtml(byflintHtml(w, m, l));
    } catch (e) {
      if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
    }
  }

  sheet.body.addEventListener("click", async (e) => {
    const btn = e.target.closest(".eco-checkin");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Checking in…";
    try {
      await api.doCheckin();
      refresh();
    } catch (err) {
      btn.textContent = err.message || "Couldn't check in";
      return;
    }
    await load();
  });

  await load();
}

/* ----------------------------- animated hourglass ----------------------------- */

let glassSeq = 0;

function hourglassSvg(hex) {
  const id = `scClip${++glassSeq}`;
  return `<svg class="sc-glass" viewBox="0 0 120 200" aria-hidden="true">
    <defs><clipPath id="${id}"><path d="${GLASS}"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <rect class="sc-top" x="0" y="16" width="120" height="84" fill="${esc(hex)}" opacity=".5"/>
      <rect class="sc-bottom" x="0" y="186" width="120" height="0" fill="${esc(hex)}"/>
      <line class="sc-stream" x1="60" y1="100" x2="60" y2="186" stroke="${esc(hex)}" stroke-width="2.2" stroke-dasharray="3 5"/>
    </g>
    <path d="${GLASS}" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" opacity=".85"/>
    <g class="sc-grains"></g>
  </svg>`;
}

function mountHourglass(host, hex, onTick) {
  const svg = host.querySelector(".sc-glass");
  const top = svg.querySelector(".sc-top");
  const bottom = svg.querySelector(".sc-bottom");
  const stream = svg.querySelector(".sc-stream");
  const grainsG = svg.querySelector(".sc-grains");
  const BULB = 84, NECK = 100, FLOOR = 186;
  let shown = 0, tween = 0, alive = true;
  const grains = [];

  for (let i = 0; i < 5; i++) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("r", "1.7");
    c.setAttribute("fill", hex);
    c.setAttribute("cx", "60");
    c.setAttribute("cy", String(NECK));
    grainsG.appendChild(c);
    grains.push({ c, off: i / 5 });
  }

  const level = (p) => (p > 0 ? Math.max(p, 2.5) : 0) / 100;

  function draw(p) {
    const v = level(p);
    const bh = BULB * v, th = BULB * (1 - v);
    bottom.setAttribute("y", String(FLOOR - bh));
    bottom.setAttribute("height", String(bh));
    top.setAttribute("y", String(NECK - th));
    top.setAttribute("height", String(th));
    stream.setAttribute("y2", String(FLOOR - bh));
  }

  function loop(t) {
    if (!alive || !svg.isConnected) return;
    const surf = FLOOR - BULB * level(shown);
    const flowing = shown < 99.9 && !reduceMotion;
    stream.style.opacity = flowing ? "0.9" : "0";
    stream.setAttribute("stroke-dashoffset", String(-((t / 40) % 8)));
    grains.forEach((g) => {
      const ph = ((t / 900) + g.off) % 1;
      g.c.setAttribute("cx", String(60 + Math.sin(t / 130 + g.off * 9) * 1.4));
      g.c.setAttribute("cy", String(Math.min(surf - 1, NECK + ph * Math.max(0, surf - NECK - 2))));
      g.c.style.opacity = flowing ? "0.9" : "0";
    });
    requestAnimationFrame(loop);
  }

  draw(0);
  if (onTick) onTick(0);
  requestAnimationFrame(loop);

  return {
    to(target, ms, done) {
      cancelAnimationFrame(tween);
      const from = shown, start = performance.now(), dur = reduceMotion ? 0 : ms;
      const step = (now) => {
        const k = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        shown = from + (target - from) * e;
        draw(shown);
        if (onTick) onTick(shown);
        if (k < 1) tween = requestAnimationFrame(step);
        else if (done) done();
      };
      tween = requestAnimationFrame(step);
    },
    burst() {
      if (reduceMotion) return;
      for (let i = 0; i < 14; i++) {
        const sp = document.createElement("span");
        sp.className = "sc-spark";
        sp.style.background = hex;
        host.appendChild(sp);
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 46;
        sp.animate(
          [
            { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
            { transform: `translate(${Math.cos(a) * d - 3}px,${Math.sin(a) * d - 3}px) scale(.3)`, opacity: 0 },
          ],
          { duration: 700 + Math.random() * 400, easing: "ease-out" }
        ).onfinish = () => sp.remove();
      }
    },
    stop() { alive = false; cancelAnimationFrame(tween); },
  };
}

/* ----------------------------- Sandclock screen ----------------------------- */

function sandHtml(s, m) {
  const f = m.fill;
  const ladder = s.colors.map((c, i) => {
    const n = i + 1;
    const cls = n < s.color.index ? "sc-done" : n === s.color.index ? "sc-now" : "";
    return `<span class="sc-step ${cls}" style="--c:${esc(c.hex)}" title="${esc(c.name)}"></span>`;
  }).join("");
  const d = s.decay;
  const plural = (n) => (n === 1 ? "" : "s");
  const decayLine = s.idle_days === 0
    ? "Active today — no decay."
    : `Inactive ${s.idle_days} day${plural(s.idle_days)}. Next drain in ${d.next_in_days} day${plural(d.next_in_days)}: −${d.next_drain_pct}%.`;
  const signals = [
    ["Like", `${f.like}%`], ["Comment", `${f.comment}%`],
    ["Live session (10 min)", `${f.live_session}%`], ["Gig-section active day", `${f.gig_active_day}%`],
    ["Gig completed", `${f.gig_completed}%`], ["Gig won", `${f.gig_won}%`],
    ["Daily check-in", `${m.checkin.fill_pct}%`],
  ].map(([l, v]) => `<div class="eco-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("");

  return `
    <div class="sc-wrap">
      <div class="sc-hourglass">${hourglassSvg(s.color.hex)}</div>
      <div class="sc-info">
        <div class="sc-name"><span class="sc-dot" style="background:${esc(s.color.hex)}"></span>${esc(s.color.name)}</div>
        <div class="sc-pct">${pctText(0)}</div>
        <div class="ps-note">Colour ${s.color.index} of ${s.colors.length}${s.level ? ` · Level ${s.level}` : ""}</div>
        <div class="sc-boost">+${s.boost_pct}% earnings</div>
      </div>
    </div>
    <div class="sc-ladder">${ladder}</div>
    <div class="md-block">
      <div class="md-title">Decay</div>
      <div class="md-pad">${esc(decayLine)}</div>
      <div class="ps-note">After ${m.sandclock.decay.start_after_days} idle days, ${m.sandclock.decay.base_pct}% of the fill drains, then a little more every ${m.sandclock.decay.step_days} days. Colours and levels never drop.</div>
    </div>
    <div class="md-block">
      <div class="md-title">What fills it</div>
      ${signals}
      <div class="ps-note">Likes and comments share a ${m.caps.social_fill_pct_per_day}% daily cap. Finishing all ${s.colors.length} colours earns a Level badge and restarts the colours.</div>
    </div>`;
}

function mountView(sheet, s) {
  const host = sheet.body.querySelector(".sc-hourglass");
  const pctEl = sheet.body.querySelector(".sc-pct");
  if (!host || !pctEl) return;
  const hg = mountHourglass(host, s.color.hex, (v) => { pctEl.textContent = pctText(v); });
  hg.to(s.fill, 1500);
  live = {
    sheet,
    update(ns, ps) {
      if (!sheet.isOpen()) { hg.stop(); live = null; return; }
      const colorUp = ns.color.index !== ps.color.index || ns.level !== ps.level;
      if (colorUp) {
        hg.to(100, 700, () => {
          hg.burst();
          hg.stop();
          sheet.setHtml(sandHtml(ns, manifest));
          mountView(sheet, ns);
        });
      } else if (ns.fill !== ps.fill) {
        hg.to(ns.fill, 900);
        if (ns.fill > ps.fill) hg.burst();
      }
    },
  };
}

async function openSandclock() {
  const sheet = openSheet({ title: "Sandclock", html: SKEL });
  try {
    const [s, m] = await Promise.all([api.getSandclock(), manifest ? Promise.resolve(manifest) : api.getManifest()]);
    sand = s;
    manifest = m;
    paint();
    if (!sheet.isOpen()) return;
    sheet.setHtml(sandHtml(s, m));
    mountView(sheet, s);
    const poll = setInterval(() => {
      if (!sheet.isOpen()) { clearInterval(poll); return; }
      refresh();
    }, 12000);
  } catch (e) {
    if (sheet.isOpen()) sheet.setHtml(`<div class="match-data-error">${esc(e.message)}</div>`);
  }
}

/* --------------------------------- startup --------------------------------- */

async function afterLogin() {
  if (!getToken()) return;
  try { await api.pingActive(); } catch (e) { /* ignore */ }
  refresh();
}

function start() {
  ensureStrip();
  window.addEventListener("himate:authed", afterLogin);
  document.addEventListener("hm:net-recovered", refresh);
  if (getToken()) afterLogin();
  setInterval(() => { if (!document.hidden) refresh(); }, 90000);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);

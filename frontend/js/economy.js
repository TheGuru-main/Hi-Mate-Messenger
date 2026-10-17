// Economy: a strip under the home header with two separate pills (Sandclock, Byflint) and their screens.
import { api, getToken } from "./api.js";
import { openSheet } from "./sheet.js";

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

const KIND = {
  checkin: "Daily check-in", like: "Like reward", comment: "Comment reward", share: "Share reward",
  spot_gem: "Spot a Gem", klique: "New Klique", gift_sent: "Gift sent", gift_received: "Gift received",
  gig_entry: "Gig entry", gig_payout: "Gig prize", gig_refund: "Gig refund",
};

let strip = null;
let wallet = null;
let sand = null;
let manifest = null;

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
  s.querySelector(".eco-sand-text").textContent =
    `${sand.fill.toFixed(1)}%${sand.level ? ` · Lv ${sand.level}` : ""}`;
  s.querySelector('[data-eco="sand"] .eco-ico').style.color = sand.color.hex;
  s.querySelector(".eco-coin-text").textContent =
    `${short(wallet.balance)} B${wallet.pending ? ` +${short(wallet.pending)}` : ""}`;
}

async function refresh() {
  if (!getToken()) return;
  try {
    const [w, sc] = await Promise.all([api.getWallet(), api.getSandclock()]);
    wallet = w;
    sand = sc;
    paint();
  } catch (e) { /* keep the last values */ }
}

/* ------------------------------ Byflint screen ------------------------------ */

function byflintHtml(w, m, ledger) {
  const c = m.currency;
  const wd = m.gates.withdraw;
  const tfc = w.balance / c.byflint_per_tfc;
  const pct = (cur, need) => Math.min(100, Math.round((cur / need) * 100));
  const meter = (label, cur, need, shown) => `
    <div class="eco-row"><span>${esc(label)}</span><b>${esc(shown)}</b></div>
    <div class="eco-track"><div class="eco-fill" style="width:${pct(cur, need)}%"></div></div>`;
  const rates = [
    ["Daily check-in", m.checkin.byflint], ["Like", m.rewards.like], ["Comment", m.rewards.comment],
    ["Share", m.rewards.share], ["Spot a Gem", m.rewards.spot_gem], ["New Klique", m.rewards.klique],
  ].map(([l, v]) => `<div class="eco-row"><span>${esc(l)}</span><b>${fmt(v)} B</b></div>`).join("");
  const hist = (ledger || []).map((r) => {
    const label = KIND[r.kind] || r.kind;
    const sign = r.amount > 0 ? "+" : "";
    return `<div class="eco-row"><span>${esc(label)}${r.status === "pending" ? " · pending" : ""}</span><b>${sign}${fmt(r.amount)} B</b></div>`;
  }).join("");

  return `
    <div class="eco-balance">
      <div class="eco-big">${fmt(w.balance)} <small>B</small></div>
      <div class="eco-sub">≈ ₦${fmt(w.naira_value)} · ${fmt(w.pending)} B pending (≈ ₦${fmt(w.pending_naira)})</div>
    </div>
    <div class="md-block">
      <div class="md-title">Daily check-in</div>
      <div class="md-pad">
        <button type="button" class="primary-btn eco-checkin" ${w.checked_in ? "disabled" : ""}>
          ${w.checked_in ? "Checked in today ✓" : `Check in · +${fmt(m.checkin.byflint)} B`}
        </button>
        <div class="ps-note">Rewards are held ${esc(m.pending_hours)} hours before you can spend them.</div>
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
    </div>
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

async function openByflint() {
  const sheet = openSheet({ title: "Byflint", html: '<div class="md-skel"></div><div class="md-skel"></div>' });

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
      <div class="sc-bucket"><div class="sc-fluid" style="height:${Math.min(100, s.fill)}%;background:${esc(s.color.hex)}"></div></div>
      <div class="sc-info">
        <div class="sc-name"><span class="sc-dot" style="background:${esc(s.color.hex)}"></span>${esc(s.color.name)}</div>
        <div class="sc-pct">${s.fill.toFixed(1)}%</div>
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

async function openSandclock() {
  const sheet = openSheet({ title: "Sandclock", html: '<div class="md-skel"></div><div class="md-skel"></div>' });
  try {
    const [s, m] = await Promise.all([api.getSandclock(), manifest ? Promise.resolve(manifest) : api.getManifest()]);
    sand = s;
    manifest = m;
    paint();
    if (sheet.isOpen()) sheet.setHtml(sandHtml(s, m));
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

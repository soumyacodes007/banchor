// In-page buy suggestion. While a session is on, the background worker sends NUDGE every few
// tracked minutes; this shows a small card in the corner of the page being scrolled.
(() => {
  if (window.top !== window) return;
  // After an extension reload the old copy is orphaned (chrome.runtime.id is gone): replace it.
  if (window.__ddNudgeAlive?.()) return;
  window.__ddNudgeAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  document.querySelectorAll("[data-banchor]").forEach((el) => el.remove());

  let host = null, hideTimer = null;
  const close = () => { clearTimeout(hideTimer); host?.remove(); host = null; };

  function show({ ticker, company, usd, minutes }) {
    close();
    host = document.createElement("div");
    host.dataset.banchor = "nudge";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .card { width:300px; background:#F7F4ED; color:#172B73; border:2px solid #075BFF; border-radius:18px; padding:14px 16px;
                font:13px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; box-shadow:0 12px 32px rgba(23,43,115,.22);
                animation:in .22s ease-out; }
        @keyframes in { from { transform:translateY(12px); opacity:0 } }
        @media (prefers-reduced-motion: reduce) { .card { animation:none } }
        .top { display:flex; justify-content:space-between; align-items:center; }
        .label { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:#5B6AA3; font-weight:600; }
        .x { border:0; background:none; color:#5B6AA3; font-size:18px; line-height:1; cursor:pointer; padding:0 2px; }
        .big { font:400 30px/1.05 "Instrument Serif",Georgia,serif; color:#075BFF; margin:6px 0 2px; }
        .dim { color:#5B6AA3; }
        .btns { display:flex; gap:8px; margin-top:12px; }
        button.b { flex:1; padding:9px 10px; border-radius:12px; border:1.5px solid #075BFF; background:#fff; color:#075BFF; font:inherit; font-weight:600; cursor:pointer; }
        button.b.p { background:#075BFF; color:#fff; }
        button.b:disabled { opacity:.5; cursor:default; }
        .err { color:#D34C86; font-size:12px; margin-top:8px; }
        .err:empty { display:none; }
      </style>
      <div class="card" role="dialog" aria-label="Banchor buy suggestion">
        <div class="top"><span class="label">Banchor · ${minutes} min scrolled</span><button class="x" aria-label="Dismiss">×</button></div>
        <div class="big">Buy $${usd.toFixed(2)} of ${esc(company)}</div>
        <div class="dim">That's what your time on this feed earned. ${esc(ticker)}</div>
        <div class="btns"><button class="b later">Later</button><button class="b p buy">Buy</button></div>
        <div class="err"></div>
      </div>`;
    root.querySelector(".x").onclick = close;
    root.querySelector(".later").onclick = close;
    root.querySelector(".buy").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Opening…";
      const res = await chrome.runtime.sendMessage({ type: "NUDGE_BUY", ticker }).catch((err) => ({ error: err.message }));
      if (res?.error) { root.querySelector(".err").textContent = res.error; e.target.disabled = false; e.target.textContent = "Buy"; }
      else close();
    };
    document.documentElement.appendChild(host);
    hideTimer = setTimeout(close, 20_000); // never block the feed for long
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === "NUDGE") show(msg); });

  // ---------- live session pill: "● Banchor 04:12  $0.0070 → Tesla  Stop" ----------
  // This script is also the counter: every second the user is actively on a visible feed
  // (scrolled in the last few seconds, or a video is playing) counts, sent in 5s batches.
  let pill = null, pillRoot = null, state = null, tick = null;
  let lastActivity = 0, pending = 0, localUsd = 0;
  const ACTIVE_WINDOW_MS = 4000;
  const pad = (n) => String(n).padStart(2, "0");
  const clock = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec % 60); return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`; };

  const mark = () => (lastActivity = Date.now());
  for (const ev of ["scroll", "wheel", "touchmove", "mousemove", "keydown"]) addEventListener(ev, mark, { capture: true, passive: true });
  const videoPlaying = () => [...document.querySelectorAll("video")].some((v) => !v.paused && !v.ended && v.readyState > 2 && v.offsetWidth > 0);
  const activeNow = () => document.visibilityState === "visible" && (Date.now() - lastActivity < ACTIVE_WINDOW_MS || videoPlaying());

  function drawPill(active) {
    if (!pillRoot || !state) return;
    pillRoot.querySelector(".t").textContent = clock((Date.now() - state.startedAt) / 1000);
    pillRoot.querySelector(".u").textContent = `$${(state.sessionUsd + localUsd).toFixed(4)} → ${state.company}`;
    pillRoot.querySelector(".dot").classList.toggle("idle", !active);
  }
  function removePill() { pill?.remove(); pill = pillRoot = null; }
  function mountPill() {
    if (pill) return;
    pill = document.createElement("div");
    pill.dataset.banchor = "pill";
    pill.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483646";
    pillRoot = pill.attachShadow({ mode: "closed" });
    pillRoot.innerHTML = `
      <style>
        .p { display:flex; align-items:center; gap:10px; padding:7px 8px 7px 14px; border-radius:999px; background:#075BFF; color:#fff;
             font:600 13px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; box-shadow:0 6px 20px rgba(7,91,255,.35);
             font-variant-numeric:tabular-nums; }
        .dot { width:8px; height:8px; border-radius:50%; background:#7CF2A0; animation:b 1.6s ease-in-out infinite; }
        .dot.idle { background:rgba(255,255,255,.45); animation:none; }
        @keyframes b { 50% { opacity:.35 } }
        @media (prefers-reduced-motion: reduce) { .dot { animation:none } }
        .u { opacity:.9; font-weight:500; }
        button { border:0; border-radius:999px; background:rgba(255,255,255,.18); color:#fff; font:inherit; font-size:11px; padding:5px 10px; cursor:pointer; }
        button:hover { background:rgba(255,255,255,.3); }
      </style>
      <div class="p" role="status" aria-label="Banchor is tracking this feed">
        <span class="dot"></span><span>Banchor</span><span class="t">00:00</span><span class="u"></span>
        <button class="stop" title="Stop tracking">Stop</button>
      </div>`;
    pillRoot.querySelector(".stop").onclick = () => chrome.runtime.sendMessage({ type: "SESSION_STOP" }).catch(() => {});
    document.documentElement.appendChild(pill);
  }

  async function flush() {
    if (!pending) return;
    const seconds = pending; pending = 0;
    await chrome.runtime.sendMessage({ type: "SESSION_SECONDS", seconds }).catch(() => {});
  }

  async function sync() {
    const st = await chrome.runtime.sendMessage({ type: "PAGE_STATE" }).catch(() => null);
    state = st?.active && st.ticker ? st : null;
    localUsd = 0; // server total now includes everything flushed so far
    if (state) { mountPill(); drawPill(activeNow()); } else removePill();
  }

  let n = 0;
  tick = setInterval(() => {
    if (!state) return;
    const active = activeNow();
    if (active) { pending += 1; localUsd += state.usdPerSec; }
    drawPill(active);
    if (++n % 5 === 0) flush();
  }, 1000);

  sync();
  // Start/Stop from the popup or the pill shows/hides instantly; counted seconds refresh totals.
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && (c.session || c.settings)) sync(); });
  addEventListener("pagehide", flush);
})();

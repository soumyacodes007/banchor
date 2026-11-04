// Live mode badge (Instagram, YouTube). PRD: counts seconds while the tab is visible and
// the user is scrolling or a video is playing; badge updates every second.
(() => {
  if (window.__ddLive) return;
  window.__ddLive = true;

  let liveMode = false;
  let company = null;
  let lastScroll = 0;
  let badge = null;
  let timer = null;

  const SCROLL_WINDOW_MS = 2000; // a scroll keeps the second "active" for 2s

  addEventListener("scroll", () => (lastScroll = Date.now()), { capture: true, passive: true });
  addEventListener("wheel", () => (lastScroll = Date.now()), { capture: true, passive: true });
  addEventListener("touchmove", () => (lastScroll = Date.now()), { capture: true, passive: true });
  addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "j", "k"].includes(e.key)) lastScroll = Date.now();
  }, { capture: true, passive: true });

  function videoPlaying() {
    for (const v of document.querySelectorAll("video")) {
      if (!v.paused && !v.ended && v.readyState > 2 && v.offsetWidth > 0) return true;
    }
    return false;
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function ensureBadge() {
    if (badge) return badge;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .b{font:600 14px/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#075BFF;
           background:#F7F4ED;border:1.5px solid #075BFF;border-radius:18px;padding:10px 16px 14px;position:relative;overflow:hidden;
           box-shadow:0 8px 26px rgba(23,43,115,.22);font-variant-numeric:tabular-nums;transition:transform .15s}
        .b::after{content:"";position:absolute;left:0;right:0;bottom:0;height:5px;
           background:repeating-conic-gradient(#075BFF 0 25%,transparent 0 50%) 0 0/5px 5px}
        .b.pulse{transform:scale(1.06)}
        .t{font:400 22px/1 "Instrument Serif",Georgia,serif}
        .s{display:block;font-weight:500;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#172B73;opacity:.7;margin-top:4px}
      </style>
      <div class="b"><span class="t">0:00 scrolled</span><span class="s">Banchor · Monad testnet</span></div>`;
    document.documentElement.appendChild(host);
    badge = { host, box: root.querySelector(".b"), text: root.querySelector(".t") };
    return badge;
  }
  function removeBadge() { badge?.host.remove(); badge = null; }

  async function tick() {
    if (!liveMode || document.visibilityState !== "visible") return;
    const active = Date.now() - lastScroll < SCROLL_WINDOW_MS || videoPlaying();
    if (!active) return;
    let res;
    try { res = await chrome.runtime.sendMessage({ type: "LIVE_SECONDS", seconds: 1 }); }
    catch { return stop(); } // extension reloaded
    if (!res?.ok) return;
    const b = ensureBadge();
    b.text.textContent = `${fmt(res.liveSeconds)} scrolled · +$${res.liveUsd.toFixed(2)} of ${company}`;
    b.box.classList.add("pulse");
    setTimeout(() => b.box.classList.remove("pulse"), 150);
  }

  function start() { if (!timer) timer = setInterval(tick, 1000); }
  function stop() { clearInterval(timer); timer = null; removeBadge(); }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "LIVE_TOGGLE") return;
    liveMode = msg.liveMode;
    liveMode ? start() : stop();
  });

  chrome.runtime.sendMessage({ type: "LIVE_STATE" }).then((s) => {
    if (!s?.ticker) return;
    company = s.company;
    liveMode = s.liveMode;
    if (liveMode) start();
  }).catch(() => {});
})();

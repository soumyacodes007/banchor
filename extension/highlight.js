// Highlight to buy. The selection is matched by the background worker against tickers.json
// (bundled with the extension). Nothing leaves the laptop unless the user taps Buy.
(() => {
  if (window.__ddHighlight || window.top !== window) return;
  window.__ddHighlight = true;

  let host = null, root = null, current = null, seq = 0;

  function close() { host?.remove(); host = root = current = null; }

  function render(rect, data) {
    close();
    host = document.createElement("div");
    host.style.cssText = `position:absolute;z-index:2147483647;left:${Math.max(8, rect.left + scrollX)}px;top:${rect.bottom + scrollY + 8}px`;
    root = host.attachShadow({ mode: "closed" });
    const price = data.price != null ? `$${Number(data.price).toFixed(2)}` : "";
    const owned = data.ownedUsd != null ? `You own $${Number(data.ownedUsd).toFixed(2)}` : "";
    root.innerHTML = `
      <style>
        .c{font:500 13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;background:#200052;
           border:1px solid #836EF9;border-radius:12px;padding:10px 12px;min-width:240px;box-shadow:0 8px 28px rgba(0,0,0,.35)}
        .h{display:flex;gap:8px;align-items:baseline;margin-bottom:8px}
        .t{font-weight:700}.n{opacity:.8}.p{margin-left:auto;font-variant-numeric:tabular-nums}
        .r{display:flex;gap:6px}
        button{font:inherit;font-weight:600;border-radius:8px;border:1px solid #836EF9;background:transparent;color:#fff;padding:6px 10px;cursor:pointer}
        button.on{background:#836EF9}
        .buy{margin-left:auto;background:#836EF9}
        .f{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;opacity:.75}
        .f a{color:#fff;cursor:pointer;text-decoration:underline}
        .msg{margin-top:8px;font-size:12px}
      </style>
      <div class="c" role="dialog" aria-label="Buy ${data.ticker}">
        <div class="h"><span class="t">${data.ticker}</span><span class="n">${data.company}</span><span class="p">${price}</span></div>
        <div class="r">
          <button data-usd="1">$1</button><button data-usd="5" class="on">$5</button><button data-usd="20">$20</button>
          <button class="buy">Buy</button>
        </div>
        <div class="f"><span>${owned}</span><a class="never">Never on this site</a></div>
        <div class="msg" hidden></div>
      </div>`;
    document.documentElement.appendChild(host);

    let usd = 5;
    root.querySelectorAll("button[data-usd]").forEach((b) => b.addEventListener("click", () => {
      usd = Number(b.dataset.usd);
      root.querySelectorAll("button[data-usd]").forEach((x) => x.classList.toggle("on", x === b));
    }));
    root.querySelector(".buy").addEventListener("click", async () => {
      const msg = root.querySelector(".msg");
      msg.hidden = false;
      msg.textContent = "Opening your wallet to confirm…";
      const res = await chrome.runtime.sendMessage({ type: "HIGHLIGHT_BUY", text: current, usd });
      msg.textContent = res?.error ? `Couldn't buy: ${res.error}` : `Confirm $${usd} of ${data.ticker} in the new tab.`;
      if (!res?.error) setTimeout(close, 2500);
    });
    root.querySelector(".never").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "BLOCK_SITE" });
      close();
    });
    host.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  document.addEventListener("mousedown", (e) => { if (host && !e.composedPath().includes(host)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, true);

  document.addEventListener("mouseup", () => {
    setTimeout(async () => {
      const sel = getSelection();
      const text = sel?.toString().trim() || "";
      if (!text || text.length > 40 || sel.rangeCount === 0) return;
      const el = sel.anchorNode?.parentElement;
      if (el?.closest("input,textarea,[contenteditable=''],[contenteditable='true']")) return; // never interrupt typing
      const my = ++seq;
      let data;
      try { data = await chrome.runtime.sendMessage({ type: "MATCH_SELECTION", text }); } catch { return; }
      if (my !== seq || !data || data.error) return;
      current = text;
      render(sel.getRangeAt(0).getBoundingClientRect(), data);
    }, 10);
  }, true);
})();

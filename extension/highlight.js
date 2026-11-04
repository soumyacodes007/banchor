// Highlight to trade. The selection is matched by the background worker against tickers.json
// (bundled with the extension), so only listed stocks ever show the bar. Nothing leaves the
// laptop unless the user taps Buy or Sell.
// Also reads the page for Analyze, but only when the user taps that button in the popup.
(() => {
  if (window.__ddHighlight || window.top !== window) return;
  window.__ddHighlight = true;

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== "READ_ARTICLE") return;
    const el = document.querySelector("article") || document.querySelector("main") || document.body;
    reply({ url: location.href, title: document.title, text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 12000) });
  });

  const GAP = 8;
  let host = null, root = null, current = null, seq = 0;

  function close() { host?.remove(); host = root = current = null; }

  function render(rect, data) {
    close();
    host = document.createElement("div");
    host.style.cssText = "position:absolute;z-index:2147483647;visibility:hidden;left:0;top:0";
    root = host.attachShadow({ mode: "closed" });
    const price = data.price != null ? `$${Number(data.price).toFixed(2)}` : "";
    const owned = data.ownedUsd > 0 ? `You own $${Number(data.ownedUsd).toFixed(2)}` : "";
    root.innerHTML = `
      <style>
        .c{font:500 13px/1.35 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172B73;background:#F7F4ED;
           border:1.5px solid #075BFF;border-radius:18px;padding:12px 14px 10px;min-width:260px;box-shadow:0 10px 30px rgba(23,43,115,.22);
           position:relative;overflow:hidden}
        .c::after{content:"";position:absolute;left:0;right:0;bottom:0;height:6px;
           background:repeating-conic-gradient(#075BFF 0 25%,transparent 0 50%) 0 0/6px 6px;opacity:.9}
        .h{display:flex;gap:8px;align-items:baseline;margin-bottom:10px}
        .t{font:400 22px/1 "Instrument Serif",Georgia,serif;color:#075BFF}.n{color:#5B6AA3}.p{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}
        .a{display:flex;gap:8px;margin-bottom:8px}
        .r{display:flex;gap:6px}
        button{font:inherit;font-weight:600;border-radius:12px;border:1.5px solid #075BFF;background:#fff;color:#075BFF;padding:6px 11px;cursor:pointer}
        button:hover{background:#C9D2FF}
        button.on{background:#C9D2FF}
        .a button{flex:1;padding:9px 11px}
        .buy,.buy:hover{background:#075BFF;color:#fff}
        .sell{border-color:#D34C86;color:#D34C86}
        .sell:hover{background:#FBE4EE}
        .f{display:flex;justify-content:space-between;gap:12px;margin:10px 0 6px;font-size:11px;color:#5B6AA3}
        .f a{color:#D34C86;cursor:pointer;text-decoration:underline}
        .msg{margin-top:8px;font-size:12px}
      </style>
      <div class="c" role="dialog" aria-label="Trade ${data.ticker}">
        <div class="h"><span class="t">${data.ticker}</span><span class="n">${data.company}</span><span class="p">${price}</span></div>
        <div class="a">
          <button class="buy">Buy</button>
          ${data.canSell ? `<button class="sell">Sell</button>` : ""}
        </div>
        <div class="r"><button data-usd="1">$1</button><button data-usd="5" class="on">$5</button><button data-usd="20">$20</button></div>
        <div class="f"><span>${owned}</span><a class="never">Never on this site</a></div>
        <div class="msg" hidden></div>
      </div>`;
    document.documentElement.appendChild(host);

    // Above the selection, unless that would run off the top of the window.
    const height = host.offsetHeight;
    const above = rect.top - height - GAP >= 0;
    const top = above ? rect.top - height - GAP : rect.bottom + GAP;
    host.style.left = `${Math.max(GAP, rect.left + scrollX)}px`;
    host.style.top = `${top + scrollY}px`;
    host.style.visibility = "visible";

    let usd = 5;
    root.querySelectorAll("button[data-usd]").forEach((b) => b.addEventListener("click", () => {
      usd = Number(b.dataset.usd);
      root.querySelectorAll("button[data-usd]").forEach((x) => x.classList.toggle("on", x === b));
    }));

    async function trade(type, verb) {
      const msg = root.querySelector(".msg");
      msg.hidden = false;
      msg.textContent = "Opening your wallet to confirm…";
      const res = await chrome.runtime.sendMessage({ type, text: current, usd });
      msg.textContent = res?.error ? `Couldn't ${verb}: ${res.error}` : `Confirm in the new tab.`;
      if (!res?.error) setTimeout(close, 2500);
    }
    root.querySelector(".buy").addEventListener("click", () => trade("HIGHLIGHT_BUY", "buy"));
    root.querySelector(".sell")?.addEventListener("click", () => trade("HIGHLIGHT_SELL", "sell"));
    root.querySelector(".never").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "BLOCK_SITE" });
      close();
    });
    host.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  document.addEventListener("mousedown", (e) => { if (host && !e.composedPath().includes(host)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, true);

  document.addEventListener("mouseup", (e) => {
    if (host && e.composedPath().includes(host)) return; // a click on the bar isn't a new selection
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

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const EXPLORER = "https://testnet.monadvision.com/tx/";

function hours(sec) {
  const h = sec / 3600;
  return h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(sec / 60)} min`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

async function render() {
  const st = await send({ type: "POPUP_STATE" });
  if (st?.error) { $("err").textContent = st.error; return; }
  const { settings, week, basket, history, usdc, chainError, tickers, session } = st;

  // Rate
  const rate = Number(settings.scrollUsdPerMin) || 0.1;
  document.querySelectorAll(".rates button").forEach((b) => {
    const on = Math.abs(Number(b.dataset.rate) - rate) < 1e-9;
    b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
  });
  if (document.activeElement !== $("rateCustom")) $("rateCustom").value = rate.toFixed(2);
  $("rateHint").textContent = `$${(rate * 60).toFixed(2)} / hour`;

  // Start / Stop
  const on = !!session?.active;
  $("start").classList.toggle("on", on);
  $("start").textContent = on ? "■ Stop tracking" : "▶ Start";
  $("start").disabled = !settings.wallet && !on;
  $("start").title = settings.wallet ? "" : "Connect your wallet first";
  $("sessionInfo").hidden = !on && !!settings.wallet;
  if (!on) $("sessionText").textContent = "Connect your wallet below to start";
  tickerInfo = tickers;
  liveSession(on);
  document.querySelector("#sessionInfo .rec").hidden = !on;

  document.querySelectorAll(".mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === settings.mode));

  // This week's minutes per site, biggest first
  const sites = Object.entries(week.siteSeconds).sort((a, b) => b[1] - a[1]);
  $("sites").innerHTML = sites.length
    ? sites.map(([site, sec]) => {
        const t = tickers.sites[site];
        const note = t ? tickers.stocks[t].company : site === "x.com" ? "not even investable" : "";
        return `<div class="row"><span>${esc(site)} <span class="dim">${esc(note)}</span></span><span>${hours(sec)}</span></div>`;
      }).join("")
    : `<div class="empty">Nothing tracked yet this week.</div>`;

  // What it would buy
  $("buyLabel").textContent = settings.mode === "detox" ? "Time saved buys the S&P 500" : "Ready to buy";
  const total = basket.reduce((a, b) => a + b.usd, 0);
  $("total").textContent = `$${total.toFixed(2)}`;
  $("basket").innerHTML = basket.map((i) => {
    const deployed = settings.addresses[i.ticker] ? "" : ` <span class="dim">· soon</span>`;
    return `<div class="row"><span>$${i.usd.toFixed(2)} of ${esc(tickers.stocks[i.ticker]?.company || i.ticker)}${deployed}</span><span class="dim">${esc(i.ticker)}</span></div>`;
  }).join("");
  $("buy").disabled = !basket.length;

  $("usdc").textContent = usdc != null ? `$${usdc.toFixed(2)}` : chainError ? "Unavailable" : "—";
  if (chainError) $("err").textContent = chainError;

  $("history").innerHTML = history.map((h) =>
    `<div class="row"><span>${esc(h.source.toLowerCase())} · $${h.items.reduce((a, b) => a + b.usd, 0).toFixed(2)}</span>
     <a href="${EXPLORER}${esc(h.txHash)}" target="_blank">view tx</a></div>`).join("");

  $("live").checked = settings.liveMode;
  $("highlight").checked = settings.highlightEnabled;
  $("weekly").checked = settings.buyPolicy === "weekly";

  for (const k of ["wallet", "dashboardUrl", "backendUrl", "rpcUrl"]) $(k).value = settings[k] || "";
  $("addresses").value = Object.keys(settings.addresses).length ? JSON.stringify(settings.addresses, null, 1) : "";
  const w = settings.wallet;
  $("acct").innerHTML = w ? `${esc(w.slice(0, 6))}…${esc(w.slice(-4))}<span class="ok">Mera</span>` : "Not connected";
  $("connect").hidden = !w;
  $("passkey").hidden = !!w;
  $("passkeyHint").hidden = !!w;
}

// Live session readout: clock ticks every second, dollars climb as seconds are counted.
let sessionTimer = null, tickerInfo = null;
const companyOf = (t) => tickerInfo?.stocks?.[t]?.company || t;
function liveSession(on) {
  clearInterval(sessionTimer);
  $("sessionLive").hidden = !on;
  if (!on) return;
  const pad = (n) => String(n).padStart(2, "0");
  const draw = async () => {
    const st = await send({ type: "SESSION_STATE" });
    if (!st?.active) return;
    const sec = Math.floor((Date.now() - st.startedAt) / 1000);
    $("sessionText").textContent = "Tracking · close this and just scroll";
    $("sessionClock").textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    $("sessionUsd").textContent = `$${st.total.toFixed(4)}`;
    $("sessionItems").innerHTML = st.items.length
      ? st.items.map((i) => `<div class="row"><span>${esc(i.company)} <span class="dim">${esc(i.ticker)} · ${Math.floor(i.seconds / 60)}:${pad(Math.floor(i.seconds % 60))}</span></span><span>$${i.usd.toFixed(4)}</span></div>`).join("")
      : `<div class="empty">Open X, Instagram or YouTube and scroll.</div>`;
    // One tap: buy everything earned and not yet bought (opens the dashboard to confirm with passkey).
    const b = $("sessionBuy");
    if (!b.dataset.busy) {
      const top = st.basket[0];
      b.disabled = !st.basket.length;
      b.textContent = !st.basket.length ? "Keep scrolling…"
        : st.basket.length === 1 ? `Buy $${top.usd.toFixed(2)} of ${companyOf(top.ticker)}`
        : `Buy $${st.basketUsd.toFixed(2)} of ${st.basket.length} stocks`;
    }
  };
  draw();
  sessionTimer = setInterval(draw, 1000);
}

async function act(msg) {
  $("err").textContent = "";
  const res = await send(msg);
  if (res?.error) $("err").textContent = res.error;
  else await render();
  return res;
}

document.querySelectorAll(".mode button").forEach((b) =>
  b.addEventListener("click", () => act({ type: "SAVE_SETTINGS", patch: { mode: b.dataset.mode } })));
$("buy").addEventListener("click", async () => { const r = await act({ type: "BUY_SCROLL" }); if (!r?.error) window.close(); });
const setRate = (v) => {
  const n = Math.round(Number(v) * 100) / 100;
  if (!(n >= 0.01 && n <= 10)) { $("err").textContent = "Rate must be $0.01 to $10 per minute"; return; }
  act({ type: "SAVE_SETTINGS", patch: { scrollUsdPerMin: n } });
};
document.querySelectorAll(".rates button").forEach((b) => b.addEventListener("click", () => setRate(b.dataset.rate)));
$("rateCustom").addEventListener("change", (e) => setRate(e.target.value));

$("sessionBuy").addEventListener("click", async () => {
  const b = $("sessionBuy");
  b.dataset.busy = "1"; b.disabled = true; b.textContent = "Opening dashboard…"; $("sessionErr").textContent = "";
  const r = await send({ type: "BUY_SCROLL" });
  if (r?.error) { $("sessionErr").textContent = r.error; delete b.dataset.busy; b.disabled = false; }
  else window.close();
});
$("start").addEventListener("click", async () => {
  const on = $("start").classList.contains("on");
  const r = await act({ type: on ? "SESSION_STOP" : "SESSION_START" });
  if (!on && !r?.error) window.close(); // started: get out of the way
});
$("notNow").addEventListener("click", () => window.close());
$("connect").addEventListener("click", () => act({ type: "OPEN_DASHBOARD" }));
$("passkey").addEventListener("click", () => act({ type: "OPEN_DASHBOARD", signin: true }));
// Developer settings stay hidden from users: Alt/Option-click the footer to reveal them.
$("footer").addEventListener("click", (e) => {
  if (!e.altKey) return;
  const cfg = $("cfg"), sec = cfg.closest("section");
  cfg.hidden = !cfg.hidden; sec.hidden = cfg.hidden; cfg.open = !cfg.hidden;
});
$("topup").addEventListener("click", () => act({ type: "TOP_UP" }));

// One-click research: reads the open page and suggests what to buy. Buying is a separate tap.
function renderAnalysis(a) {
  const total = a.picks.reduce((sum, p) => sum + p.usd, 0);
  const note = a.source === "saved" ? "Saved analysis" : "AI analysis";
  $("analysis").hidden = false;
  $("analysis").innerHTML = `
    <div class="idea">${esc(a.headline)}</div>
    <p class="dim">${esc(a.summary)}</p>
    ${a.picks.map((p) => `<div class="pick"><div class="row"><span>Buy $${esc(p.usd)} of ${esc(p.company)}</span><span class="dim">${esc(p.ticker)}</span></div><div class="dim">${esc(p.reason)}</div></div>`).join("")}
    ${a.picks.length ? `<button class="full primary" id="analysisBuy">Buy $${esc(total)} of these</button>` : `<div class="empty">No Banchor stocks on this page.</div>`}
    <div class="fine">${note} · Mock stocks on testnet · Not financial advice</div>`;
  $("analysisBuy")?.addEventListener("click", async () => {
    $("analyzeErr").textContent = "";
    const res = await send({ type: "ANALYSIS_BUY", picks: a.picks });
    if (res?.error) $("analyzeErr").textContent = res.error;
    else window.close();
  });
}
$("analyze").addEventListener("click", async () => {
  const button = $("analyze");
  $("analyzeErr").textContent = "";
  $("analysis").hidden = true;
  button.disabled = true;
  button.textContent = "Reading this page…";
  const res = await send({ type: "ANALYZE_PAGE" });
  button.disabled = false;
  button.textContent = "Analyze this page";
  if (res?.error) $("analyzeErr").textContent = res.error;
  else renderAnalysis(res);
});
$("reset").addEventListener("click", () => { if (confirm("Drop this week's unbought amounts?")) act({ type: "RESET_UNBOUGHT" }); });
$("live").addEventListener("change", (e) => act({ type: "SAVE_SETTINGS", patch: { liveMode: e.target.checked } }));
$("highlight").addEventListener("change", (e) => act({ type: "SAVE_SETTINGS", patch: { highlightEnabled: e.target.checked } }));
$("weekly").addEventListener("change", (e) => act({ type: "SAVE_SETTINGS", patch: { buyPolicy: e.target.checked ? "weekly" : "stream" } }));

$("save").addEventListener("click", async () => {
  $("cfgErr").textContent = "";
  const patch = {};
  for (const k of ["wallet", "dashboardUrl", "backendUrl", "rpcUrl"]) patch[k] = $(k).value.trim();
  try { patch.addresses = $("addresses").value.trim() ? JSON.parse($("addresses").value) : {}; }
  catch { $("cfgErr").textContent = "addresses.json is not valid JSON"; return; }

  // Backend/dashboard on a custom domain need host permission to be called from the extension.
  const origins = [patch.backendUrl, patch.rpcUrl].filter((u) => /^https:\/\//.test(u)).map((u) => new URL(u).origin + "/*");
  if (origins.length) {
    const ok = await chrome.permissions.request({ origins }).catch(() => false);
    if (!ok) { $("cfgErr").textContent = "Permission to reach the backend/RPC was declined."; return; }
  }
  const res = await send({ type: "SAVE_SETTINGS", patch });
  if (res?.error) $("cfgErr").textContent = res.error;
  else await render();
});

render();

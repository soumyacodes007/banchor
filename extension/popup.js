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
  const { settings, week, basket, history, usdc, chainError, tickers } = st;

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

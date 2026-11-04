// Doomscroll Dividends: background service worker (Manifest V3)
// - Counts minutes per site every 60s (PRD "Counting rules")
// - Adds Live mode seconds from live.js
// - Turns earned dollars into buy intents (chunks / weekly / highlight)
// - Hands every buy to the dashboard, where the user's passkey or session key signs it.
//   The extension never holds keys and never buys on its own.
// - Verifies the resulting transaction on Monad testnet before marking anything bought.

const MONAD_CHAIN_ID = 10143;
const DEFAULT_SETTINGS = {
  wallet: "",                         // user's smart-account address (set by dashboard or pasted)
  backendUrl: "",                     // e.g. https://dd-backend.up.railway.app
  dashboardUrl: "",                   // e.g. https://doomscroll.vercel.app
  rpcUrl: "https://testnet-rpc.monad.xyz",
  addresses: {},                      // contents of backend/addresses.json
  mode: "roast",                      // "roast" | "detox"
  ratePer10Min: 0.10,                 // PRD default: $0.10 per 10 minutes
  liveRatePerMin: 1.0,                // PRD Live mode: $1 per minute
  chunkUsd: 0.30,                     // PRD v2: one buy per 30 tracked minutes at the default rate
  liveChunkSec: 20,                   // PRD v2: Live mode chunk every 20 seconds
  buyPolicy: "stream",                // "stream" (chunks) | "weekly" ("Ask me weekly")
  liveMode: false,
  highlightEnabled: true,
  blockedSites: [],
  detoxBaselineMin: 20 * 60           // PRD: hardcoded 20 hours a week
};
const MIN_BUY_USD = 0.01;             // PRD: skip any stock under $0.01

let tickerData = null;
async function tickers() {
  if (!tickerData) tickerData = await (await fetch(chrome.runtime.getURL("tickers.json"))).json();
  return tickerData;
}

// ---------- storage ----------
async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
async function setSettings(patch) {
  const s = await getSettings();
  const next = { ...s, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

function mondayStart(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x.getTime();
}
function emptyWeek() {
  return {
    weekStart: mondayStart(),
    siteSeconds: {},      // { "instagram.com": 50400 }
    tickerSeconds: {},    // { METAx: 50400 }
    earnedUsd: {},        // { METAx: 8.40 } dollars earned at the rate in force when counted
    boughtUsd: {},        // confirmed onchain
    queuedUsd: {},        // inside an open intent, not yet confirmed
    liveSeconds: {}       // seconds that came from Live mode
  };
}
async function getWeek() {
  const { week } = await chrome.storage.local.get("week");
  if (!week || week.weekStart !== mondayStart()) {
    const fresh = emptyWeek();
    // PRD: "unbought amounts keep adding up until the user taps Buy or Reset".
    // Totals reset on Monday, but unbought dollars carry over.
    if (week) {
      for (const t of Object.keys(week.earnedUsd || {})) {
        const left = (week.earnedUsd[t] || 0) - (week.boughtUsd[t] || 0) - (week.queuedUsd?.[t] || 0);
        if (left > 0) fresh.earnedUsd[t] = left;
      }
    }
    await chrome.storage.local.set({ week: fresh });
    return fresh;
  }
  return week;
}
async function saveWeek(week) { await chrome.storage.local.set({ week }); }

function add(map, k, v) { map[k] = (map[k] || 0) + v; }
function round2(n) { return Math.floor(n * 100) / 100; }

// ---------- site mapping ----------
function siteOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return host;
  } catch { return null; }
}
async function trackedSite(url) {
  const host = siteOf(url);
  if (!host) return null;
  const { sites } = await tickers();
  for (const s of Object.keys(sites)) {
    if (host === s || host.endsWith("." + s)) return { site: s, ticker: sites[s] };
  }
  return null;
}
const LIVE_SITES = ["instagram.com", "youtube.com"];

// ---------- counting (PRD "Counting rules") ----------
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "dd-buy", title: "Buy with Doomscroll Dividends", contexts: ["selection"], visible: false });
  });
  await getWeek();
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("tick", { periodInMinutes: 1 }));

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "tick") return;
  await countMinute();
});

async function countMinute() {
  const win = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  if (!win || !win.focused) return;
  const tab = win.tabs?.find((t) => t.active);
  if (!tab?.url) return;
  const hit = await trackedSite(tab.url);
  if (!hit) return;

  const settings = await getSettings();
  // In Live mode, live.js is the source of truth for Instagram and YouTube (no double count).
  if (settings.liveMode && LIVE_SITES.includes(hit.site)) return;

  const idle = await chrome.idle.queryState(60);
  const { videoSites } = await tickers();
  const active = idle === "active" || (videoSites.includes(hit.site) && tab.audible);
  if (!active) return;

  await addSeconds(hit.site, hit.ticker, 60, false);
}

let writeChain = Promise.resolve();
function addSeconds(...args) {
  const p = writeChain.then(() => addSecondsUnsafe(...args));
  writeChain = p.catch(() => {});
  return p;
}
async function addSecondsUnsafe(site, ticker, secs, fromLive) {
  const settings = await getSettings();
  const week = await getWeek();
  add(week.siteSeconds, site, secs);
  if (ticker) {
    add(week.tickerSeconds, ticker, secs);
    const usd = fromLive
      ? (secs / 60) * settings.liveRatePerMin
      : (secs / 600) * settings.ratePer10Min;
    add(week.earnedUsd, ticker, usd);
    if (fromLive) add(week.liveSeconds, ticker, secs);
  }
  await saveWeek(week);
  if (ticker && settings.buyPolicy === "stream" && settings.mode === "roast") {
    await maybeQueueChunk(ticker, fromLive);
  }
  return week;
}

function unboughtUsd(week, t) {
  return (week.earnedUsd[t] || 0) - (week.boughtUsd[t] || 0) - (week.queuedUsd[t] || 0);
}

// ---------- chunked scroll buys (PRD v2 "Scroll dividends") ----------
// A chunk becomes a *pending* buy. It is sent when the user taps Buy (popup, badge),
// because signing needs the user's passkey/session key in the dashboard.
async function maybeQueueChunk(ticker, fromLive) {
  const settings = await getSettings();
  const week = await getWeek();
  const chunk = fromLive
    ? (settings.liveChunkSec / 60) * settings.liveRatePerMin
    : settings.chunkUsd;
  if (unboughtUsd(week, ticker) >= chunk) {
    await chrome.action.setBadgeText({ text: "$" });
    await chrome.action.setBadgeBackgroundColor({ color: "#836EF9" });
  }
}

// ---------- amounts ----------
async function computeBasket() {
  const settings = await getSettings();
  const week = await getWeek();
  const items = [];
  if (settings.mode === "detox") {
    // PRD: saved = baseline - minutes; dollars = (saved / 10) * rate, all SPYx.
    // Baseline is weekly; prorate it to the part of the week that has passed.
    const elapsed = Math.min(1, (Date.now() - week.weekStart) / (7 * 864e5));
    const minutes = Object.values(week.siteSeconds).reduce((a, b) => a + b, 0) / 60;
    const saved = settings.detoxBaselineMin * elapsed - minutes;
    const usd = saved > 0 ? (saved / 10) * settings.ratePer10Min - (week.boughtUsd.SPYx || 0) - (week.queuedUsd.SPYx || 0) : 0;
    if (usd >= MIN_BUY_USD) items.push({ ticker: "SPYx", usd: round2(usd) });
  } else {
    for (const t of Object.keys(week.earnedUsd)) {
      const usd = unboughtUsd(week, t);
      if (usd >= MIN_BUY_USD) items.push({ ticker: t, usd: round2(usd) });
    }
  }
  items.sort((a, b) => b.usd - a.usd);
  return items;
}

// ---------- backend (PRD endpoints) ----------
async function api(path, opts = {}) {
  const { backendUrl } = await getSettings();
  if (!backendUrl) throw new Error("Backend URL not set");
  const res = await fetch(backendUrl.replace(/\/$/, "") + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// PRD: "sends only weekly totals per ticker, never page history".
async function postMinutes() {
  const { wallet } = await getSettings();
  if (!wallet) throw new Error("Wallet not connected");
  const week = await getWeek();
  const minutes = {};
  for (const [t, s] of Object.entries(week.tickerSeconds)) minutes[t] = Math.round(s / 60);
  return api("/api/minutes", { method: "POST", body: JSON.stringify({ address: wallet, minutes }) });
}

let priceCache = { at: 0, data: null };
async function getPrices() {
  if (Date.now() - priceCache.at < 60_000 && priceCache.data) return priceCache.data;
  const data = await api("/api/prices");
  priceCache = { at: Date.now(), data };
  return data;
}
let portfolioCache = { at: 0, data: null };
async function getPortfolio() {
  const { wallet } = await getSettings();
  if (!wallet) return null;
  if (Date.now() - portfolioCache.at < 30_000 && portfolioCache.data) return portfolioCache.data;
  const data = await api(`/api/portfolio/${wallet}`);
  portfolioCache = { at: Date.now(), data };
  return data;
}

// ---------- Monad testnet (direct JSON-RPC, no mocks) ----------
async function rpc(method, params) {
  const { rpcUrl } = await getSettings();
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function checkChain() {
  const id = parseInt(await rpc("eth_chainId", []), 16);
  if (id !== MONAD_CHAIN_ID) throw new Error(`RPC is chain ${id}, expected Monad testnet ${MONAD_CHAIN_ID}`);
  return id;
}
async function usdcBalance() {
  const { wallet, addresses } = await getSettings();
  if (!wallet || !addresses.MockUSDC) return null;
  const data = "0x70a08231" + wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0"); // balanceOf(address)
  const raw = await rpc("eth_call", [{ to: addresses.MockUSDC, data }, "latest"]);
  return Number(BigInt(raw)) / 1e6;
}
async function waitForReceipt(hash, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("Timed out waiting for receipt");
}

// ---------- buy intents → dashboard ----------
// The dashboard (web/lib/buy.ts) reads ?intent=..., builds the batched approve + buy/buyBasket call,
// signs with passkey or session key, then reports back via chrome.runtime.sendMessage(EXT_ID, {type:"DD_BOUGHT"...}).
const SOURCES = ["SCROLL", "HIGHLIGHT", "COPY", "GIFT"];
async function createIntent(items, source) {
  if (!SOURCES.includes(source)) throw new Error("bad source");
  const settings = await getSettings();
  if (!settings.dashboardUrl) throw new Error("Dashboard URL not set");
  const priced = [];
  for (const it of items) {
    const stock = settings.addresses[it.ticker];
    if (!stock) throw new Error(`${it.ticker} has no address in addresses.json`);
    if (it.usd < MIN_BUY_USD) continue;
    priced.push({ ticker: it.ticker, stock, usdc: String(Math.round(it.usd * 1e6)), usd: it.usd });
  }
  if (!priced.length) throw new Error("Nothing to buy");

  const intent = { id: crypto.randomUUID(), chainId: MONAD_CHAIN_ID, source, items: priced, createdAt: Date.now() };
  const week = await getWeek();
  for (const it of priced) add(week.queuedUsd, it.ticker, it.usd);
  await saveWeek(week);
  const { intents = {} } = await chrome.storage.local.get("intents");
  intents[intent.id] = intent;
  await chrome.storage.local.set({ intents });

  if (source === "SCROLL") await postMinutes().catch(() => {}); // backend may be down; buy still goes through dashboard
  const url = `${settings.dashboardUrl.replace(/\/$/, "")}/dashboard?intent=${encodeURIComponent(btoa(JSON.stringify(intent)))}`;
  await chrome.tabs.create({ url });
  return intent;
}

async function releaseIntent(id) {
  const { intents = {} } = await chrome.storage.local.get("intents");
  const intent = intents[id];
  if (!intent) return;
  const week = await getWeek();
  for (const it of intent.items) week.queuedUsd[it.ticker] = Math.max(0, (week.queuedUsd[it.ticker] || 0) - it.usd);
  await saveWeek(week);
  delete intents[id];
  await chrome.storage.local.set({ intents });
}

async function confirmIntent(id, txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("bad tx hash");
  const { intents = {} } = await chrome.storage.local.get("intents");
  const intent = intents[id];
  if (!intent) throw new Error("unknown intent");
  const settings = await getSettings();
  const receipt = await waitForReceipt(txHash);
  if (receipt.status !== "0x1") { await releaseIntent(id); throw new Error("Transaction reverted"); }
  // Must have touched ScrollBasket (directly, or via the smart account / entry point emitting its logs).
  const basket = settings.addresses.ScrollBasket?.toLowerCase();
  if (basket && !receipt.logs.some((l) => l.address.toLowerCase() === basket)) {
    throw new Error("Transaction did not call ScrollBasket");
  }
  const week = await getWeek();
  for (const it of intent.items) {
    week.queuedUsd[it.ticker] = Math.max(0, (week.queuedUsd[it.ticker] || 0) - it.usd);
    add(week.boughtUsd, it.ticker, it.usd);
  }
  await saveWeek(week);
  delete intents[id];
  const { history = [] } = await chrome.storage.local.get("history");
  history.unshift({ txHash, source: intent.source, items: intent.items, at: Date.now() });
  await chrome.storage.local.set({ intents, history: history.slice(0, 50) });
  portfolioCache.at = 0;
  await chrome.action.setBadgeText({ text: "" });
  return { ok: true };
}

// ---------- highlight-to-buy ----------
let matcher = null;
async function getMatcher() {
  if (matcher) return matcher;
  const { stocks } = await tickers();
  const byName = [];   // case-insensitive full names
  const bySym = {};    // case-sensitive uppercase tickers / cashtags
  for (const [t, s] of Object.entries(stocks)) {
    for (const n of s.names) byName.push([n.toLowerCase(), t]);
    for (const sym of s.tickers) bySym[sym] = t;
  }
  byName.sort((a, b) => b[0].length - a[0].length);
  matcher = { byName, bySym, stocks };
  return matcher;
}
async function matchSelection(text) {
  const raw = (text || "").trim();
  if (!raw || raw.length > 40) return null;
  const m = await getMatcher();
  const settings = await getSettings();
  let ticker = null;
  const cash = raw.match(/^\$([A-Z]{1,5})$/);
  if (cash && m.bySym[cash[1]]) ticker = m.bySym[cash[1]];
  else if (/^[A-Z]{1,5}$/.test(raw) && m.bySym[raw]) ticker = m.bySym[raw];
  else {
    const lower = raw.toLowerCase().replace(/[’']s$/, "").replace(/[.,!?:;"“”]+$/g, "");
    for (const [n, t] of m.byName) if (lower === n) { ticker = t; break; }
  }
  if (!ticker || !settings.addresses[ticker]) return null; // only offer stocks that are deployed
  return { ticker, company: m.stocks[ticker].company };
}

let lastSelection = null;
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "dd-buy" || !lastSelection) return;
  await createIntent([{ ticker: lastSelection.ticker, usd: 5 }], "HIGHLIGHT").catch((e) => console.warn(e));
});

// ---------- messages from content scripts and popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "LIVE_SECONDS": {
        const s = await getSettings();
        if (!s.liveMode || !sender.tab?.url) return { ok: false };
        const hit = await trackedSite(sender.tab.url);
        if (!hit || !LIVE_SITES.includes(hit.site)) return { ok: false };
        const secs = Math.max(0, Math.min(5, Number(msg.seconds) || 0)); // clamp: content scripts report ~1s at a time
        const week = await addSeconds(hit.site, hit.ticker, secs, true);
        return { ok: true, ticker: hit.ticker, liveSeconds: week.liveSeconds[hit.ticker] || 0, liveUsd: ((week.liveSeconds[hit.ticker] || 0) / 60) * s.liveRatePerMin };
      }
      case "LIVE_STATE": {
        const s = await getSettings();
        const hit = sender.tab?.url ? await trackedSite(sender.tab.url) : null;
        const company = hit?.ticker ? (await tickers()).stocks[hit.ticker].company : null;
        return { liveMode: s.liveMode, ticker: hit?.ticker || null, company };
      }
      case "MATCH_SELECTION": {
        const s = await getSettings();
        const host = sender.tab?.url ? siteOf(sender.tab.url) : null;
        if (!s.highlightEnabled || (host && s.blockedSites.includes(host))) { chrome.contextMenus.update("dd-buy", { visible: false }); return null; }
        const m = await matchSelection(msg.text);
        lastSelection = m;
        chrome.contextMenus.update("dd-buy", m ? { visible: true, title: `Buy $5 of ${m.ticker} (${m.company})` } : { visible: false });
        if (!m) return null;
        const [prices, portfolio] = await Promise.all([getPrices().catch(() => null), getPortfolio().catch(() => null)]);
        return { ...m, price: prices?.[m.ticker] ?? null, ownedUsd: portfolio?.[m.ticker]?.usd ?? null };
      }
      case "HIGHLIGHT_BUY": {
        const usd = Number(msg.usd);
        if (![1, 5, 20].includes(usd)) throw new Error("bad amount");
        const m = await matchSelection(msg.text);
        if (!m) throw new Error("no match");
        const intent = await createIntent([{ ticker: m.ticker, usd }], "HIGHLIGHT");
        return { ok: true, intentId: intent.id };
      }
      case "BLOCK_SITE": {
        const s = await getSettings();
        const host = sender.tab?.url ? siteOf(sender.tab.url) : null;
        if (host && !s.blockedSites.includes(host)) await setSettings({ blockedSites: [...s.blockedSites, host] });
        return { ok: true };
      }
      case "POPUP_STATE": {
        const s = await getSettings();
        const week = await getWeek();
        const basket = await computeBasket();
        const { history = [] } = await chrome.storage.local.get("history");
        let usdc = null, chainError = null;
        try { await checkChain(); usdc = await usdcBalance(); } catch (e) { chainError = e.message; }
        return { settings: s, week, basket, history: history.slice(0, 5), usdc, chainError, tickers: await tickers() };
      }
      case "BUY_SCROLL": {
        const basket = await computeBasket();
        const intent = await createIntent(basket, "SCROLL");
        return { ok: true, intentId: intent.id };
      }
      case "TOP_UP": {
        // PRD: sponsored MockUSDC.faucet() — signed by the user's account in the dashboard.
        const s = await getSettings();
        if (!s.dashboardUrl) throw new Error("Dashboard URL not set");
        await chrome.tabs.create({ url: `${s.dashboardUrl.replace(/\/$/, "")}/dashboard?topup=50` });
        return { ok: true };
      }
      case "RESET_UNBOUGHT": {
        const week = await getWeek();
        for (const t of Object.keys(week.earnedUsd)) week.earnedUsd[t] = (week.boughtUsd[t] || 0) + (week.queuedUsd[t] || 0);
        await saveWeek(week);
        await chrome.action.setBadgeText({ text: "" });
        return { ok: true };
      }
      case "SAVE_SETTINGS": {
        const patch = { ...msg.patch };
        if (patch.wallet && !/^0x[0-9a-fA-F]{40}$/.test(patch.wallet)) throw new Error("Invalid wallet address");
        if (typeof patch.addresses === "string") patch.addresses = JSON.parse(patch.addresses);
        const next = await setSettings(patch);
        priceCache.at = 0; portfolioCache.at = 0;
        // Tell open Instagram/YouTube tabs that Live mode changed.
        if ("liveMode" in patch) {
          for (const t of await chrome.tabs.query({ url: ["https://www.instagram.com/*", "https://www.youtube.com/*"] })) {
            chrome.tabs.sendMessage(t.id, { type: "LIVE_TOGGLE", liveMode: next.liveMode }).catch(() => {});
          }
        }
        return { ok: true, settings: next };
      }
      default:
        return null;
    }
  })().then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});

// ---------- messages from the dashboard (externally_connectable) ----------
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  (async () => {
    const s = await getSettings();
    if (s.dashboardUrl && new URL(sender.url).origin !== new URL(s.dashboardUrl).origin) throw new Error("origin not allowed");
    switch (msg?.type) {
      case "DD_PING": return { ok: true, version: chrome.runtime.getManifest().version };
      case "DD_SET_WALLET":
        if (!/^0x[0-9a-fA-F]{40}$/.test(msg.address)) throw new Error("Invalid address");
        await setSettings({ wallet: msg.address });
        return { ok: true };
      case "DD_GET_INTENT": {
        const { intents = {} } = await chrome.storage.local.get("intents");
        return intents[msg.intentId] || null;
      }
      case "DD_BOUGHT": return confirmIntent(msg.intentId, msg.txHash);
      case "DD_CANCELLED": await releaseIntent(msg.intentId); return { ok: true };
      default: return null;
    }
  })().then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});

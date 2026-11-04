"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Brand, Footer } from "@/components/Brand";
import { Dither } from "@/components/Dither";
import { SignIn, Fingerprint } from "@/components/SignIn";
import { savedWallet, forgetWallet, withSigner, friendlyError } from "@/lib/wallet";
import { usdcBalance, monBalance, stockBalances, buyIntent, publicClient, boughtFromReceipt, FAUCET_USD, type Intent } from "@/lib/chain";
import { TopUpModal } from "@/components/TopUpModal";
import { toExtension, rememberExtensionId } from "@/lib/extension";
import { api, short, usd } from "@/lib/api";
import { EXPLORER, STOCKS, ADDRESSES } from "@/lib/config";

type Activity = { hash: string; source: string; usd: number; at: number; label: string; items?: { ticker: string; usd: number }[] };
const ACT_KEY = "banchor.activity";
const loadActivity = (): Activity[] => { try { return JSON.parse(localStorage.getItem(ACT_KEY) || "[]"); } catch { return []; } };
const pushActivity = (a: Activity) => localStorage.setItem(ACT_KEY, JSON.stringify([a, ...loadActivity()].slice(0, 50)));

function decodeIntent(raw: string | null): Intent | null {
  if (!raw) return null;
  try {
    // URLSearchParams turns an unescaped "+" into a space; restore base64.
    const i = JSON.parse(atob(raw.replace(/ /g, "+"))) as Intent;
    const ok = i && typeof i.id === "string" && Array.isArray(i.items) && i.items.length > 0 &&
      i.items.every((it) => /^0x[0-9a-fA-F]{40}$/.test(it.stock) && /^\d+$/.test(String(it.usdc)) && BigInt(it.usdc) > 0n);
    return ok ? i : null;
  } catch { return null; }
}

function Dashboard() {
  const params = useSearchParams();
  const router = useRouter();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [mon, setMon] = useState<number | null>(null);
  const [stocks, setStocks] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [activity, setActivity] = useState<Activity[]>([]);
  const [tab, setTab] = useState<"holdings" | "history">("holdings");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [ext, setExt] = useState<boolean | null>(null);

  const intent = useMemo(() => decodeIntent(params.get("intent")), [params]);
  const topupParam = params.get("topup");
  const wantsSignIn = params.get("signin") === "mera";
  const [intentOpen, setIntentOpen] = useState(true);

  useEffect(() => {
    rememberExtensionId(params.get("ext"));
    setAddress(savedWallet()?.address ?? null);
    setActivity(loadActivity());
    setReady(true);
    toExtension<{ ok: boolean }>({ type: "DD_PING" }).then((r) => setExt(!!r?.ok));
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    // Balances come straight from the chain (no indexer lag right after a buy); prices from the backend.
    const [u, m, s, p] = await Promise.all([
      usdcBalance(address).catch(() => null), monBalance(address).catch(() => null),
      stockBalances(address).catch(() => null),
      api<Record<string, number>>("/api/prices"),
    ]);
    setUsdc(u); setMon(m); setPrices(p || {});
    if (s) { setStocks(s); return; }
    // Chain read failed: use the backend's indexed portfolio instead of showing nothing.
    const port = await api<{ holdings: { ticker: string; balance: string }[] }>(`/api/portfolio/${address}`);
    if (port?.holdings) setStocks(Object.fromEntries(port.holdings.map((h) => [h.ticker, Number(h.balance) / 1e18])));
  }, [address]);
  useEffect(() => { refresh(); }, [refresh]);

  // Re-send the wallet to the extension whenever the dashboard opens signed in.
  useEffect(() => { if (address) toExtension({ type: "DD_SET_WALLET", address }); }, [address]);

  const clearParams = () => router.replace("/dashboard");

  const [topUpOpen, setTopUpOpen] = useState(false);
  useEffect(() => { if (topupParam && address) setTopUpOpen(true); }, [topupParam, address]);
  const doTopUp = () => { setToast(null); setTopUpOpen(true); };
  function closeTopUp() {
    setTopUpOpen(false);
    if (topupParam) router.replace(intent ? `/dashboard?intent=${encodeURIComponent(params.get("intent")!)}` : "/dashboard");
  }
  function toppedUp(hash: `0x${string}`) {
    pushActivity({ hash, source: "TOP-UP", usd: FAUCET_USD, at: Date.now(), label: `Top up ${usd(FAUCET_USD)}` });
    setActivity(loadActivity());
    refresh();
  }

  async function confirmBuy() {
    if (!intent) return;
    setBusy("Unlocking wallet…"); setToast(null);
    try {
      const hash = await withSigner((acc) => buyIntent(acc, intent, setBusy));
      setBusy("Confirming on Monad…");
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      // The extension re-checks the receipt and releases the intent on revert.
      toExtension({ type: "DD_BOUGHT", intentId: intent.id, txHash: hash });
      if (rcpt.status !== "success") throw new Error("Transaction reverted");
      const total = intent.items.reduce((a, b) => a + b.usd, 0);
      const label = intent.items.map((i) => `${usd(i.usd)} ${STOCKS[i.ticker] || i.ticker}`).join(" + ");
      pushActivity({ hash, source: intent.source, usd: total, at: Date.now(), label, items: intent.items.map((i) => ({ ticker: i.ticker, usd: i.usd })) });
      setActivity(loadActivity());
      const got = boughtFromReceipt(rcpt);
      const gotText = got.length
        ? got.map((g) => `${g.shares < 0.001 ? g.shares.toPrecision(3) : g.shares.toFixed(4)} ${g.ticker} for ${usd(g.usd)}`).join(", ")
        : label;
      setToast({ ok: true, text: `Bought ${gotText} on Monad`, hash });
      setIntentOpen(false); setTab("holdings"); clearParams();
      refresh(); setTimeout(refresh, 3000); // RPC nodes can lag a block behind the receipt
    } catch (e) { setToast({ ok: false, text: friendlyError(e) }); } finally { setBusy(""); }
  }
  async function cancelBuy() {
    if (intent) await toExtension({ type: "DD_CANCELLED", intentId: intent.id });
    setIntentOpen(false); clearParams();
  }

  if (!ready) return null;

  if (!address) {
    return (
      <main className="wrap">
        <header className="top"><Brand /></header>
        <section className="hero" style={{ minHeight: 380 }}>
          <Dither seed={4} px={4} tentacle={1} />
          <div className="copy">
            <h1><span>{wantsSignIn ? "Sign in to Banchor." : "Your scroll, your stocks."}</span></h1>
            <p className="lead">{intent ? "Sign in to confirm your buy." : "Create your passkey wallet to connect the extension."}</p>
            <SignIn onDone={(a) => setAddress(a)} />
          </div>
        </section>
        <Footer />
      </main>
    );
  }

  const holdings = Object.entries(stocks).filter(([, v]) => v > 0);
  const value = holdings.reduce((a, [t, v]) => a + (prices[t] ? v * prices[t] : 0), 0);
  // Dollars put into each stock through this dashboard (this browser's history).
  const invested: Record<string, number> = {};
  for (const a of activity) for (const it of a.items || []) invested[it.ticker] = (invested[it.ticker] || 0) + it.usd;
  const investedTotal = Object.values(invested).reduce((a, b) => a + b, 0);
  const rows = holdings
    .map(([ticker, shares]) => {
      const price = prices[ticker] || 0;
      return { ticker, shares, price, value: shares * price, invested: invested[ticker] || 0, pct: value ? (shares * price * 100) / value : 0 };
    })
    .sort((a, b) => b.value - a.value);
  const intentTotal = intent?.items.reduce((a, b) => a + b.usd, 0) ?? 0;

  return (
    <main className="wrap">
      <header className="top">
        <Brand small />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {ext === true && <span className="pill">Extension connected</span>}
          {ext === false && <span className="pill mag">Extension not found</span>}
          <span className="pill blue mono">{short(address)}</span>
        </div>
      </header>

      {params.get("welcome") && !toast && <div className="toast ok"><span>Wallet ready. Top up, then go scroll.</span></div>}
      {toast && (
        <div className={`toast ${toast.ok ? "ok" : "bad"}`}>
          <span>{toast.text}</span>
          {toast.hash && <a href={`${EXPLORER}/tx/${toast.hash}`} target="_blank" rel="noreferrer">View tx →</a>}
        </div>
      )}

      <div className="grid">
        <section className="card blue c7">
          <div className="banner"><Dither seed={21} px={3} tentacle={1} /></div>
          <div className="label">Portfolio value</div>
          <div className="big-num">{Object.keys(prices).length ? usd(value) : holdings.length ? `${holdings.length} stocks` : "$0.00"}</div>
          {holdings.length ? holdings.map(([t, v]) => (
            <div className="row" key={t}>
              <span>{STOCKS[t] || t} <span className="dim">{t}</span></span>
              <span>{prices[t] ? usd(v * prices[t]) : `${v.toFixed(6)} sh`}</span>
            </div>
          )) : <p className="empty">Nothing yet. Scroll Instagram or highlight “Nvidia” to make your first buy.</p>}
        </section>

        <section className="card c5">
          <div className="label">Wallet</div>
          <div className="row"><span>USDC</span><b>{usdc == null ? "—" : usd(usdc)}</b></div>
          <div className="row"><span>MON <span className="dim">gas</span></span><span>{mon == null ? "—" : mon.toFixed(3)}</span></div>
          <div className="row"><span>Address</span><a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{short(address)}</a></div>
          <div className="actions">
            <button className="btn primary" disabled={!!busy} onClick={() => doTopUp()}>Top up {usd(FAUCET_USD)}</button>
            <Link className="btn" href={`/roast/${address}`}>My roast card</Link>
          </div>
          {mon !== null && mon < 0.01 && <p className="error">You need a little test MON for gas: <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">faucet.monad.xyz</a></p>}
          {!ADDRESSES.MockUSDC && <p className="error">Contracts aren't configured (lib/addresses.json).</p>}
          <div className="strip"><Dither kind="strip" seed={9} px={2} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <span className="dim" style={{ fontSize: 12 }}>Secured by a Mera passkey</span>
            <button className="btn ghost" style={{ padding: 0, fontSize: 12 }} onClick={() => { forgetWallet(); setAddress(null); }}>Sign out</button>
          </div>
        </section>

        <section className="card c12">
          <div className="card-head">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "holdings"} className={tab === "holdings" ? "on" : ""} onClick={() => setTab("holdings")}>Your stocks{rows.length ? ` · ${rows.length}` : ""}</button>
              <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History{activity.length ? ` · ${activity.length}` : ""}</button>
            </div>
            <button className="btn ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={refresh}>Refresh</button>
          </div>

          {tab === "holdings" ? (
            <>
              <div className="summary">
                <div><div className="label">Stocks</div><b>{usd(value)}</b></div>
                <div><div className="label">Cash</div><b>{usdc == null ? "—" : usd(usdc)}</b></div>
                <div><div className="label">Total</div><b>{usd(value + (usdc ?? 0))}</b></div>
                <div><div className="label">Invested via Banchor</div><b>{usd(investedTotal)}</b></div>
              </div>
              {rows.length ? (
                <div className="table-wrap">
                  <table className="holdings">
                    <thead><tr><th>Stock</th><th>Shares</th><th>Price</th><th>Value</th><th>Invested</th><th className="alloc-h">Allocation</th></tr></thead>
                    <tbody>
                      {rows.map((h) => (
                        <tr key={h.ticker}>
                          <td><b>{STOCKS[h.ticker] || h.ticker}</b> <span className="dim">{h.ticker}</span></td>
                          <td>{h.shares < 0.0001 ? h.shares.toExponential(2) : h.shares.toFixed(4)}</td>
                          <td>{h.price ? usd(h.price) : "—"}</td>
                          <td><b>{h.price ? usd(h.value) : "—"}</b></td>
                          <td>{h.invested ? usd(h.invested) : "—"}</td>
                          <td className="alloc"><span className="bar"><i style={{ width: `${h.pct}%` }} /></span><span className="dim">{h.pct.toFixed(0)}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="empty">No stocks yet. Scroll Instagram or highlight “Nvidia” to make your first buy.</p>}
            </>
          ) : activity.length ? activity.map((a) => (
            <div className="row" key={a.hash}>
              <span><span className="pill blue" style={{ marginRight: 8 }}>{a.source.toLowerCase()}</span>{a.label}</span>
              <span className="dim">{new Date(a.at).toLocaleString()} · <a href={`${EXPLORER}/tx/${a.hash}`} target="_blank" rel="noreferrer">tx</a></span>
            </div>
          )) : <p className="empty">Your buys will show up here.</p>}
        </section>
      </div>

      {intent && intentOpen && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="label">{intent.source === "HIGHLIGHT" ? "Highlight buy" : "Buy my scroll"}</div>
            <h2>{usd(intentTotal)}</h2>
            {intent.items.map((i) => (
              <div className="row" key={i.ticker}><span>{STOCKS[i.ticker] || i.ticker}</span><span>{usd(i.usd)}</span></div>
            ))}
            {usdc != null && usdc < intentTotal && <p className="error">Not enough USDC. Top up first.</p>}
            <div className="actions">
              <button className="btn" onClick={cancelBuy} disabled={!!busy}>Cancel</button>
              {usdc != null && usdc < intentTotal
                ? <button className="btn primary" onClick={() => doTopUp()} disabled={!!busy}>Top up {usd(FAUCET_USD)}</button>
                : <button className="btn primary" onClick={confirmBuy} disabled={!!busy}><Fingerprint /> {busy || "Confirm"}</button>}
            </div>
            {toast && !toast.ok && <p className="error">{toast.text}</p>}
          </div>
        </div>
      )}

      {topUpOpen && <TopUpModal address={address} onClose={closeTopUp} onDone={toppedUp} />}
      <Footer />
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Dashboard /></Suspense>;
}

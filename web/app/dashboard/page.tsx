"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Brand, Footer } from "@/components/Brand";
import { Dither } from "@/components/Dither";
import { SignIn, Fingerprint } from "@/components/SignIn";
import { savedWallet, forgetWallet, withSigner, friendlyError } from "@/lib/wallet";
import { usdcBalance, monBalance, stockBalances, topUp, buyIntent, sellIntent, publicClient, FAUCET_USD, type Intent } from "@/lib/chain";
import { toExtension } from "@/lib/extension";
import { api, short, usd } from "@/lib/api";
import { EXPLORER, STOCKS, ADDRESSES } from "@/lib/config";

type Activity = { hash: string; source: string; usd: number; at: number; label: string };
const ACT_KEY = "banchor.activity";
const loadActivity = (): Activity[] => { try { return JSON.parse(localStorage.getItem(ACT_KEY) || "[]"); } catch { return []; } };
const pushActivity = (a: Activity) => localStorage.setItem(ACT_KEY, JSON.stringify([a, ...loadActivity()].slice(0, 50)));

function decodeIntent(raw: string | null): Intent | null {
  if (!raw) return null;
  try { return JSON.parse(atob(raw)) as Intent; } catch { return null; }
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
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [ext, setExt] = useState<boolean | null>(null);

  const intent = useMemo(() => decodeIntent(params.get("intent")), [params]);
  const topupParam = params.get("topup");
  const wantsSignIn = params.get("signin") === "mera";
  const [intentOpen, setIntentOpen] = useState(true);

  useEffect(() => {
    setAddress(savedWallet()?.address ?? null);
    setActivity(loadActivity());
    setReady(true);
    toExtension<{ ok: boolean }>({ type: "DD_PING" }).then((r) => setExt(!!r?.ok));
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    const [u, m, port] = await Promise.all([
      usdcBalance(address).catch(() => null), monBalance(address).catch(() => null),
      api<{ holdings: { ticker: string; usdValue: string }[] }>(`/api/portfolio/${address}`),
    ]);
    setUsdc(u); setMon(m);
    if (port?.holdings) {
      // Backend values are USD in 6-decimal micro units.
      setStocks(Object.fromEntries(port.holdings.map((h) => [h.ticker, 1])));
      setPrices(Object.fromEntries(port.holdings.map((h) => [h.ticker, Number(h.usdValue) / 1e6])));
    } else {
      setStocks(await stockBalances(address).catch(() => ({})));
      setPrices((await api<Record<string, number>>("/api/prices")) || {});
    }
  }, [address]);
  useEffect(() => { refresh(); }, [refresh]);

  // Re-send the wallet to the extension whenever the dashboard opens signed in.
  useEffect(() => { if (address) toExtension({ type: "DD_SET_WALLET", address }); }, [address]);

  const clearParams = () => router.replace("/dashboard");

  async function doTopUp() {
    const amount = FAUCET_USD;
    setBusy("topup"); setToast(null);
    try {
      const hash = await withSigner((acc) => topUp(acc));
      pushActivity({ hash, source: "TOP-UP", usd: amount, at: Date.now(), label: `Top up ${usd(amount)}` });
      setActivity(loadActivity());
      setToast({ ok: true, text: `Added ${usd(amount)} test USDC`, hash });
      if (topupParam) clearParams();
      refresh();
    } catch (e) { setToast({ ok: false, text: friendlyError(e) }); } finally { setBusy(""); }
  }

  async function confirmBuy() {
    if (!intent) return;
    setBusy("Unlocking wallet…"); setToast(null);
    try {
      const selling = intent.side === "SELL";
      const hash = await withSigner((acc) => (selling ? sellIntent : buyIntent)(acc, intent, setBusy));
      await toExtension({ type: "DD_BOUGHT", intentId: intent.id, txHash: hash });
      setBusy("Confirming on Monad…");
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") throw new Error("Transaction reverted");
      const total = intent.items.reduce((a, b) => a + b.usd, 0);
      const label = intent.items.map((i) => `${usd(i.usd)} ${STOCKS[i.ticker] || i.ticker}`).join(" + ");
      pushActivity({ hash, source: selling ? "SELL" : intent.source, usd: total, at: Date.now(), label });
      setActivity(loadActivity());
      setToast({ ok: true, text: `${selling ? "Sold" : "Bought"} ${label}`, hash });
      setIntentOpen(false); clearParams(); refresh();
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
  const intentTotal = intent?.items.reduce((a, b) => a + b.usd, 0) ?? 0;
  const selling = intent?.side === "SELL";
  const shortOfUsdc = !selling && usdc != null && usdc < intentTotal;

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
            <button className="btn primary" disabled={!!busy} onClick={() => doTopUp()}>{busy === "topup" ? "Topping up…" : `Top up ${usd(FAUCET_USD)}`}</button>
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
          <div className="label">Activity</div>
          {activity.length ? activity.map((a) => (
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
            <div className="label">{selling ? "Sell" : intent.source === "HIGHLIGHT" ? "Highlight buy" : "Buy my scroll"}</div>
            <h2>{usd(intentTotal)}</h2>
            {intent.items.map((i) => (
              <div className="row" key={i.ticker}><span>{STOCKS[i.ticker] || i.ticker}</span><span>{usd(i.usd)}</span></div>
            ))}
            {shortOfUsdc && <p className="error">Not enough USDC. Top up first.</p>}
            <div className="actions">
              <button className="btn" onClick={cancelBuy} disabled={!!busy}>Cancel</button>
              {shortOfUsdc
                ? <button className="btn primary" onClick={() => doTopUp()} disabled={!!busy}>{busy ? "…" : `Top up ${usd(FAUCET_USD)}`}</button>
                : <button className="btn primary" onClick={confirmBuy} disabled={!!busy}><Fingerprint /> {busy || "Confirm"}</button>}
            </div>
            {toast && !toast.ok && <p className="error">{toast.text}</p>}
          </div>
        </div>
      )}

      {topupParam && !intent && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="label">Top up</div>
            <h2>Add {usd(FAUCET_USD)} test USDC</h2>
            <p className="dim">Free on Monad testnet. Confirm with your passkey.</p>
            <div className="actions">
              <button className="btn" onClick={clearParams} disabled={!!busy}>Not now</button>
              <button className="btn primary" onClick={() => doTopUp()} disabled={!!busy}><Fingerprint /> {busy ? "Topping up…" : "Top up"}</button>
            </div>
          </div>
        </div>
      )}
      <Footer />
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Dashboard /></Suspense>;
}

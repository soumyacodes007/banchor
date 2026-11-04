"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Brand, Footer } from "@/components/Brand";
import { Dither } from "@/components/Dither";
import { Fingerprint } from "@/components/SignIn";
import { SignIn } from "@/components/SignIn";
import { api, short, usd } from "@/lib/api";
import { EXPLORER, STOCKS, chain } from "@/lib/config";
import { buyIntent, publicClient, usdcBalance } from "@/lib/chain";
import { savedWallet, withSigner, friendlyError } from "@/lib/wallet";

// GET /api/roast/:address (backend/roast.ts)
type Roast = {
  scrolledMinutes: number; copyCount: number;
  stocks: { ticker: string; company: string; minutes: number; ownedUsd: string; readyUsd: string }[];
  lines: { headline: string; thanks: string | null; highlight: string | null; x: string | null; detox: string | null; copies: string | null };
};
// GET /api/copy/:address?usd= — basket args ready for approve + buyBasket
type Portfolio = { totalUsd: string; holdings: { ticker: string; usd: string }[] };
type CopyArgs = { stocks: `0x${string}`[]; amounts: string[]; total: string; totalUsd: string; ref: `0x${string}`; items: { ticker: string }[] };
const COPY_USD = 5;

export default function RoastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const address = id as `0x${string}`;
  const [roast, setRoast] = useState<Roast | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [copying, setCopying] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  useEffect(() => {
    setMe(savedWallet()?.address ?? null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { setLoaded(true); return; }
    Promise.all([api<Roast>(`/api/roast/${address}`), api<Portfolio>(`/api/portfolio/${address}`)])
      .then(([r, p]) => { setRoast(r); setPortfolio(p); setLoaded(true); });
  }, [address]);

  // What the wallet actually holds on-chain (what /api/copy mirrors), with scroll minutes from the roast.
  const minutes = Object.fromEntries((roast?.stocks || []).map((s) => [s.ticker, s.minutes]));
  const holdings = (portfolio?.holdings || []).map((h) => ({
    ticker: h.ticker, company: STOCKS[h.ticker] || roast?.stocks.find((s) => s.ticker === h.ticker)?.company || h.ticker,
    minutes: minutes[h.ticker] ?? 0, ownedUsd: h.usd,
  }));

  async function copyBasket() {
    setBusy("Building basket…"); setMsg(null);
    try {
      const args = await api<CopyArgs>(`/api/copy/${address}?usd=${COPY_USD}`);
      if (!args?.stocks?.length) throw new Error("This basket is empty, nothing to copy yet.");
      const bal = me ? await usdcBalance(me).catch(() => null) : null;
      if (bal != null && bal * 1e6 < Number(args.total)) throw new Error(`Not enough USDC. Top up on your dashboard first.`);
      const intent = {
        id: crypto.randomUUID(), chainId: chain.id, source: "COPY" as const, ref: args.ref, createdAt: Date.now(),
        items: args.stocks.map((stock, i) => ({ ticker: args.items[i]?.ticker ?? "", stock, usdc: args.amounts[i], usd: Number(args.amounts[i]) / 1e6 })),
      };
      setBusy("Unlocking wallet…");
      const hash = await withSigner((acc) => buyIntent(acc, intent, setBusy));
      setBusy("Confirming on Monad…");
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") throw new Error("Transaction reverted");
      setMsg({ ok: true, text: `Copied! You bought ${args.totalUsd} of this basket.`, hash });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(""); }
  }

  return (
    <main className="wrap">
      <header className="top"><Brand small /><Link href="/dashboard" className="btn">Dashboard</Link></header>
      <section className="hero" style={{ minHeight: 460 }}>
        <Dither seed={33} px={4} tentacle={1.1} />
        <div className="copy">
          <div className="label" style={{ background: "rgba(247,244,237,.9)", display: "inline-block", padding: "2px 8px", borderRadius: 8 }}>Roast card · {short(address)}</div>
          {!loaded ? <h1><span>Loading the damage…</span></h1> : (
            <>
              <h1><span>{roast?.lines.headline ?? "No roast yet. The backend is quiet."}</span></h1>
              {roast?.lines.thanks && <p className="lead">{roast.lines.thanks}</p>}
            </>
          )}
        </div>
      </section>

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="card c7">
          <div className="label">The basket</div>
          {holdings.length ? holdings.map((h) => (
            <div className="row" key={h.ticker}><span>{h.company} <span className="dim">{h.ticker}{h.minutes ? ` · ${Math.round(h.minutes)} min` : ""}</span></span><span>{h.ownedUsd}</span></div>
          )) : <p className="empty">{loaded ? "Nothing bought yet. Suspiciously productive." : "…"}</p>}
          {[roast?.lines.highlight, roast?.lines.x, roast?.lines.detox].filter(Boolean).map((l) => <p key={l!} className="dim">{l}</p>)}
        </section>
        <section className="card blue c5">
          <div className="label">Copy this basket</div>
          <div className="big-num">{usd(COPY_USD)}</div>
          <p className="dim" style={{ marginTop: 0 }}>Same stocks, same proportions, one transaction. {roast?.lines.copies ?? ""}</p>
          {me ? (
            copying || msg ? (
              <>
                {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`}><span>{msg.text}</span>{msg.hash && <a href={`${EXPLORER}/tx/${msg.hash}`} target="_blank" rel="noreferrer">tx →</a>}</div>}
                {!msg?.ok && <button className="btn primary big" style={{ width: "100%" }} onClick={copyBasket} disabled={!!busy || !holdings.length}><Fingerprint /> {busy || "Confirm copy"}</button>}
              </>
            ) : <button className="btn primary big" style={{ width: "100%" }} onClick={() => setCopying(true)} disabled={!holdings.length}>Copy this basket</button>
          ) : <SignIn onDone={(a) => { setMe(a); setCopying(true); }} />}
          <div className="strip"><Dither kind="strip" seed={5} px={2} /></div>
        </section>
      </div>
      <Footer />
    </main>
  );
}

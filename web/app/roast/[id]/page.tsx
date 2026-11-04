"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Brand, Footer } from "@/components/Brand";
import { Dither } from "@/components/Dither";
import { Fingerprint } from "@/components/SignIn";
import { SignIn } from "@/components/SignIn";
import { api, short, usd } from "@/lib/api";
import { STOCKS, ADDRESSES, EXPLORER, chain } from "@/lib/config";
import { stockBalances, buyIntent } from "@/lib/chain";
import { savedWallet, withSigner, friendlyError } from "@/lib/wallet";
import { parseUnits } from "viem";

// Shape served by the backend's GET /api/roast/:address (PRD). Every field is optional.
type Roast = {
  hours?: number; dollars?: number; holdings?: Record<string, number>; copies?: number;
  highlights?: { ticker: string; count: number; bought: number }[]; ref?: string;
};
const THANKS: Record<string, string> = {
  METAx: "Mark Zuckerberg thanks you for your service.", GOOGLx: "Sundar Pichai thanks you for watching.",
  NFLXx: "Netflix thanks you for “just one more episode”.", AMZNx: "Jeff Bezos thanks you for browsing.",
  NVDAx: "Jensen thanks you too.", SPYx: "The whole market thanks you for logging off.",
};
const COPY_USD = 5;

export default function RoastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const address = id as `0x${string}`;
  const [roast, setRoast] = useState<Roast | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [copying, setCopying] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  useEffect(() => {
    setMe(savedWallet()?.address ?? null);
    (async () => {
      let r = await api<Roast>(`/api/roast/${address}`);
      if (!r?.holdings) {
        // No backend: fall back to onchain balances (shares, priced via /api/prices if any).
        const [bal, prices] = await Promise.all([stockBalances(address).catch(() => ({} as Record<string, number>)), api<Record<string, number>>("/api/prices")]);
        const holdings = Object.fromEntries(Object.entries(bal).filter(([, v]) => v > 0).map(([t, v]) => [t, prices?.[t] ? v * prices[t] : v]));
        r = { ...(r || {}), holdings };
      }
      setRoast(r); setLoaded(true);
    })();
  }, [address]);

  const holdings = Object.entries(roast?.holdings || {}).sort((a, b) => b[1] - a[1]);
  const top = holdings[0]?.[0];
  const total = roast?.dollars ?? holdings.reduce((a, [, v]) => a + v, 0);
  const sum = holdings.reduce((a, [, v]) => a + v, 0) || 1;
  const copyItems = holdings
    .filter(([t]) => ADDRESSES[t])
    .map(([t, v]) => ({ ticker: t, stock: ADDRESSES[t], usd: Math.max(0.01, +(COPY_USD * v / sum).toFixed(2)) }))
    .map((i) => ({ ...i, usdc: parseUnits(i.usd.toFixed(2), 6).toString() }));

  async function copyBasket() {
    setBusy("Unlocking wallet…"); setMsg(null);
    try {
      const intent = { id: crypto.randomUUID(), chainId: chain.id, source: "COPY" as const, items: copyItems, createdAt: Date.now() };
      const hash = await withSigner((acc) => buyIntent(acc, intent, setBusy));
      setMsg({ ok: true, text: `Copied! You bought ${usd(COPY_USD)} of this basket.`, hash });
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
              <h1>
                {roast?.hours != null && <><span>You scrolled {roast.hours.toFixed(0)} hours this week.</span>{" "}</>}
                <span>You now own {usd(total)}{top ? ` of ${STOCKS[top] || top}` : ""}.</span>
              </h1>
              {top && THANKS[top] && <p className="lead">{THANKS[top]}</p>}
            </>
          )}
        </div>
      </section>

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="card c7">
          <div className="label">The basket</div>
          {holdings.length ? holdings.map(([t, v]) => (
            <div className="row" key={t}><span>{STOCKS[t] || t} <span className="dim">{t}</span></span><span>{usd(v)}</span></div>
          )) : <p className="empty">{loaded ? "Nothing bought yet. Suspiciously productive." : "…"}</p>}
          {roast?.highlights?.map((h) => (
            <p key={h.ticker} className="dim">You highlighted {STOCKS[h.ticker] || h.ticker} {h.count} times and bought it {h.bought} times.</p>
          ))}
        </section>
        <section className="card blue c5">
          <div className="label">Copy this basket</div>
          <div className="big-num">{usd(COPY_USD)}</div>
          <p className="dim" style={{ marginTop: 0 }}>Same stocks, same proportions, one transaction.{roast?.copies ? ` ${roast.copies} people copied this basket.` : ""}</p>
          {me ? (
            copying || msg ? (
              <>
                {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`}><span>{msg.text}</span>{msg.hash && <a href={`${EXPLORER}/tx/${msg.hash}`} target="_blank" rel="noreferrer">tx →</a>}</div>}
                {!msg?.ok && <button className="btn primary big" style={{ width: "100%" }} onClick={copyBasket} disabled={!!busy || !copyItems.length}><Fingerprint /> {busy || "Confirm copy"}</button>}
              </>
            ) : <button className="btn primary big" style={{ width: "100%" }} onClick={() => setCopying(true)} disabled={!copyItems.length}>Copy this basket</button>
          ) : <SignIn onDone={(a) => { setMe(a); setCopying(true); }} />}
          <div className="strip"><Dither kind="strip" seed={5} px={2} /></div>
        </section>
      </div>
      <Footer />
    </main>
  );
}

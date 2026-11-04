"use client";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { Dither } from "@/components/Dither";
import { api, short, usd } from "@/lib/api";
import { BACKEND_URL, STOCKS } from "@/lib/config";

// GET /api/stats (PRD): total txns today, split by source, last 20 buys.
type Stats = {
  total: number; wallets?: number; bySource?: Record<string, number>;
  recent?: { user: string; ticker: string; usd: number; source: string; at: number }[];
};
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };

export default function Live() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let on = true;
    const tick = async () => { const s = await api<Stats>("/api/stats"); if (on && s) setStats(s); };
    tick(); const t = setInterval(tick, 1500);
    return () => { on = false; clearInterval(t); };
  }, []);
  return (
    <main className="wrap live">
      <header className="top"><Brand /><span className="pill">Live on Monad testnet</span></header>
      <div className="grid" style={{ flex: 1 }}>
        <section className="card blue c7" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="label">Transactions today</div>
            <div className="count">{stats ? stats.total.toLocaleString() : "—"}</div>
            {!BACKEND_URL && <p className="error">Set NEXT_PUBLIC_BACKEND_URL to show live stats.</p>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {Object.entries(stats?.bySource || {}).map(([k, v]) => <span key={k} className="pill blue" style={{ fontSize: 16 }}>{k.toLowerCase()} · {v}</span>)}
            {stats?.wallets != null && <span className="pill" style={{ fontSize: 16 }}>{stats.wallets} wallets</span>}
          </div>
        </section>
        <section className="card c5 feed" style={{ padding: 0 }}>
          <div style={{ height: 140 }}><Dither seed={17} px={3} tentacle={1} /></div>
          <div style={{ padding: 18 }}>
            <div className="label">Latest buys</div>
            {stats?.recent?.length ? stats.recent.slice(0, 12).map((r, i) => (
              <div className="row" key={i}><span><span className="mono">{short(r.user)}</span> bought {usd(r.usd)} {STOCKS[r.ticker] || r.ticker}</span><span className="dim">via {r.source.toLowerCase()} · {ago(r.at)}</span></div>
            )) : <p className="empty">Waiting for the first buy…</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

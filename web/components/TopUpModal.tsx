"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Fingerprint } from "@/components/SignIn";
import { withSigner, friendlyError } from "@/lib/wallet";
import { monBalance, usdcBalance, topUp, FAUCET_USD } from "@/lib/chain";
import { EXPLORER } from "@/lib/config";
import { usd } from "@/lib/api";

const MIN_GAS = 0.01; // MON; a faucet() call costs far less, this leaves room for the buy after it
const FAUCET_URL = "https://faucet.monad.xyz";

type Phase = "gas" | "sign" | "mining" | "done";
const STEPS: { key: Phase; title: string }[] = [
  { key: "gas", title: "Get test MON for gas" },
  { key: "sign", title: "Confirm with your passkey" },
  { key: "mining", title: "Minting on Monad" },
  { key: "done", title: `${usd(FAUCET_USD)} test USDC added` },
];

export function TopUpModal({ address, onClose, onDone }: {
  address: `0x${string}`;
  onClose: () => void;
  onDone: (hash: `0x${string}`) => void;
}) {
  const [mon, setMon] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("gas");
  const [err, setErr] = useState("");
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [copied, setCopied] = useState(false);

  const checkGas = useCallback(async () => {
    const m = await monBalance(address).catch(() => null);
    setMon(m);
    if (m != null && m >= MIN_GAS) setPhase((p) => (p === "gas" ? "sign" : p));
  }, [address]);

  // Watch for MON arriving while the user is on the faucet tab.
  useEffect(() => {
    checkGas();
    if (phase !== "gas") return;
    const t = setInterval(checkGas, 4000);
    return () => clearInterval(t);
  }, [checkGas, phase]);

  // Close on Escape, except mid-transaction.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "mining") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose, phase]);

  async function mint() {
    setErr("");
    try {
      const h = await withSigner(async (acc) => {
        setPhase("mining");
        return topUp(acc);
      });
      setHash(h);
      setUsdc(await usdcBalance(address).catch(() => null));
      setPhase("done");
      onDone(h);
    } catch (e) {
      setPhase("sign");
      setErr(friendlyError(e));
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  const idx = STEPS.findIndex((s) => s.key === phase);

  // Portal to <body> so no ancestor (transform/filter on the page) can block backdrop-filter.
  return createPortal(
    <div className="modal-back blur" style={BLUR} role="dialog" aria-modal="true" aria-labelledby="topup-title"
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "mining") onClose(); }}>
      <div className="modal">
        <div className="label">Top up</div>
        <h2 id="topup-title">Add {usd(FAUCET_USD)} test USDC</h2>
        <p className="dim" style={{ marginTop: 0 }}>Free on Monad testnet. Takes about a minute.</p>

        <ol className="steps-list">
          {STEPS.map((s, i) => {
            const state = i < idx || phase === "done" ? "done" : i === idx ? "now" : "todo";
            return (
              <li key={s.key} className={`step ${state}`}>
                <span className="dot" aria-hidden="true">{state === "done" ? "✓" : state === "now" && s.key === "mining" ? <span className="spin" /> : i + 1}</span>
                <div className="body">
                  <div className="title">{s.title}</div>

                  {s.key === "gas" && state === "now" && (
                    <>
                      <p className="dim">Monad needs a little MON to pay for the transaction. Paste your address into the faucet:</p>
                      <div className="addr">
                        <code>{address}</code>
                        <button className={`btn ghost icon${copied ? " copied" : ""}`} onClick={copy} aria-label={copied ? "Address copied" : "Copy address"} title={copied ? "Copied" : "Copy address"}>
                          {copied ? <TickIcon /> : <CopyIcon />}
                        </button>
                      </div>
                      <div className="actions">
                        <a className="btn primary" href={FAUCET_URL} target="_blank" rel="noreferrer">Open faucet ↗</a>
                        <button className="btn" onClick={checkGas}>Check again</button>
                      </div>
                      <p className="dim small">Balance: {mon == null ? "…" : `${mon.toFixed(3)} MON`} · checking every few seconds</p>
                    </>
                  )}
                  {s.key === "gas" && state === "done" && mon != null && <p className="dim small">{mon.toFixed(3)} MON ready</p>}

                  {s.key === "sign" && state === "now" && (
                    <>
                      <p className="dim">Touch ID signs the free mint. No money leaves your wallet.</p>
                      <div className="actions">
                        <button className="btn primary" onClick={mint}><Fingerprint /> Confirm top up</button>
                      </div>
                    </>
                  )}

                  {s.key === "mining" && state === "now" && <p className="dim small">Waiting for the block. Keep this tab open.</p>}

                  {s.key === "done" && phase === "done" && (
                    <>
                      <p className="dim small">USDC balance: {usdc == null ? "—" : usd(usdc)}{hash && <> · <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">view tx ↗</a></>}</p>
                      <div className="actions"><button className="btn primary" onClick={onClose}>Done, go scroll</button></div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {err && <p className="error">{err}</p>}
        {phase !== "done" && phase !== "mining" && (
          <button className="btn ghost close" onClick={onClose}>Not now</button>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Inline on purpose: the CSS build keeps only the -webkit- form, which Chrome ignores.
const BLUR = { backdropFilter: "blur(14px) saturate(.9)", WebkitBackdropFilter: "blur(14px) saturate(.9)" } as const;

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
const TickIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

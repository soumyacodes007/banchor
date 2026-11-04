"use client";
import { useState } from "react";
import { createWallet, signIn, friendlyError } from "@/lib/wallet";
import { toExtension } from "@/lib/extension";

export const Fingerprint = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 11v3a8 8 0 0 1-1.2 4.2M8.5 7.3A5 5 0 0 1 17 11v1.5M7 11a5 5 0 0 1 .3-1.7M5 15.5c.6-1.4 1-2.9 1-4.5a6 6 0 0 1 .7-2.8M17 15.5c-.2 1.3-.6 2.6-1.1 3.7M14.8 11.5v.5a12 12 0 0 1-1.6 6M9.6 11a2.4 2.4 0 0 1 4.8 0M19 7.5A9 9 0 0 0 3.9 6.5" />
  </svg>
);

export function SignIn({ onDone }: { onDone: (address: `0x${string}`) => void }) {
  const [busy, setBusy] = useState<"" | "new" | "back">("");
  const [err, setErr] = useState("");
  async function go(kind: "new" | "back") {
    setBusy(kind); setErr("");
    try {
      const w = kind === "new" ? await createWallet() : await signIn();
      await toExtension({ type: "DD_SET_WALLET", address: w.address });
      onDone(w.address);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(""); }
  }
  return (
    <div className="signin">
      <button className="btn primary big" disabled={!!busy} onClick={() => go("new")}>
        <Fingerprint /> {busy === "new" ? "Waiting for passkey…" : "Create wallet with Mera"}
      </button>
      <button className="btn ghost" disabled={!!busy} onClick={() => go("back")}>
        {busy === "back" ? "Waiting for passkey…" : "I already have one"}
      </button>
      <p className="hint">Passkey wallet by Monad · Touch ID, no seed phrase</p>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

"use client";
// Mera passkey wallet (Monad). The passkey is scoped to this site's hostname, so the same
// passkey always re-derives the same EVM account here. Nothing secret is stored: only the
// credential id and the public address. Each transaction asks for the passkey again.
import {
  createPasskeyWithPrfOutput, getPasskeyPrfOutput, deriveEvmPrivateKey,
  createSecp256k1SigningSession, MeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";

const KEY = "banchor.wallet";
type Saved = { credentialId: string; transports?: string[]; address: `0x${string}` };

export function savedWallet(): Saved | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function forgetWallet() { localStorage.removeItem(KEY); }

function accountFrom(prfOutput: Uint8Array) {
  const session = createSecp256k1SigningSession({ privateKey: deriveEvmPrivateKey({ prfOutput, accountIndex: 0 }) });
  return { session, account: toViemAccount(session) };
}

/** New user: creates a passkey and its account. */
export async function createWallet(): Promise<Saved> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: location.hostname, name: "Banchor" },
    user: { name: `banchor-${new Date().toISOString().slice(0, 10)}`, displayName: "Banchor wallet" },
  });
  const { session, account } = accountFrom(created.prfOutput);
  session.end();
  const saved: Saved = { credentialId: created.credentialId, transports: created.transports as string[] | undefined, address: account.address };
  localStorage.setItem(KEY, JSON.stringify(saved));
  return saved;
}

/** Returning user (or any device that syncs the passkey). */
export async function signIn(): Promise<Saved> {
  const known = savedWallet();
  const res = await getPasskeyPrfOutput({
    rpId: location.hostname,
    credential: known ? { credentialId: known.credentialId, transports: known.transports } : undefined,
  });
  const { session, account } = accountFrom(res.prfOutput);
  session.end();
  const saved: Saved = { credentialId: res.credentialId, transports: known?.credentialId === res.credentialId ? known.transports : undefined, address: account.address };
  localStorage.setItem(KEY, JSON.stringify(saved));
  return saved;
}

/** Runs `fn` with a signing account unlocked by one passkey prompt, then wipes the key. */
export async function withSigner<T>(fn: (account: LocalAccount) => Promise<T>): Promise<T> {
  const known = savedWallet();
  if (!known) throw new Error("Sign in first");
  const res = await getPasskeyPrfOutput({ rpId: location.hostname, credential: { credentialId: known.credentialId, transports: known.transports } });
  const { session, account } = accountFrom(res.prfOutput);
  try {
    if (account.address !== known.address) throw new Error("That passkey belongs to a different wallet");
    return await fn(account);
  } finally { session.end(); }
}

export function friendlyError(e: unknown): string {
  if (e instanceof MeraError) {
    switch (e.code) {
      case "PASSKEY_CANCELLED": return "Passkey prompt was closed.";
      case "PRF_UNAVAILABLE": return "This passkey provider can't make a Mera wallet. Use iCloud Keychain, Google Password Manager or 1Password.";
      case "CRYPTO_UNAVAILABLE": return "Open Banchor over https (or localhost).";
      default: return e.message;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/insufficient funds/i.test(msg)) return "Not enough MON for gas. Get test MON at faucet.monad.xyz.";
  return msg.split("\n")[0];
}

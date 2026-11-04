"use client";
import { createPublicClient, createWalletClient, http, type LocalAccount, formatUnits, parseEventLogs, type TransactionReceipt } from "viem";
import { chain, RPC_URL, ADDRESSES, STOCK_TICKERS } from "./config";
import { erc20Abi, mockUsdcAbi, scrollBasketAbi, SOURCE_ID, type Source } from "./abi";

// Reads go through Multicall3 (one eth_call) because the public Monad RPC rate-limits bursts.
// Don't enable JSON-RPC batching on the transport: that RPC rejects batch requests.
export const publicClient = createPublicClient({
  chain, transport: http(RPC_URL, { retryCount: 3, retryDelay: 400 }), batch: { multicall: true },
});
const walletClient = (account: LocalAccount) => createWalletClient({ account, chain, transport: http(RPC_URL) });

function need(name: string): `0x${string}` {
  const a = ADDRESSES[name];
  if (!a) throw new Error(`${name} address is not configured (NEXT_PUBLIC_ADDRESSES)`);
  return a;
}

export async function usdcBalance(address: `0x${string}`): Promise<number | null> {
  if (!ADDRESSES.MockUSDC) return null;
  const raw = await publicClient.readContract({ address: ADDRESSES.MockUSDC, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  return Number(formatUnits(raw, 6));
}
export async function monBalance(address: `0x${string}`): Promise<number> {
  return Number(formatUnits(await publicClient.getBalance({ address }), 18));
}

/** All stock balances in one multicall. Throws if the RPC can't be reached, so callers can fall back. */
export async function stockBalances(address: `0x${string}`): Promise<Record<string, number>> {
  const res = await publicClient.multicall({
    contracts: STOCK_TICKERS.map((t) => ({ address: ADDRESSES[t], abi: erc20Abi, functionName: "balanceOf" as const, args: [address] as const })),
    allowFailure: true,
  });
  if (res.every((r) => r.status === "failure")) throw new Error("RPC unavailable");
  const out: Record<string, number> = {};
  res.forEach((r, i) => { if (r.status === "success") out[STOCK_TICKERS[i]] = Number(formatUnits(r.result as bigint, 18)); });
  return out;
}

// Monad charges the declared gas limit, so set explicit, generous-but-bounded limits.
export const FAUCET_USD = 1000;
export async function topUp(account: LocalAccount) {
  const hash = await walletClient(account).writeContract({
    address: need("MockUSDC"), abi: mockUsdcAbi, functionName: "faucet", gas: 120_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export type IntentItem = { ticker: string; stock: `0x${string}`; usdc: string; usd: number };
export type Intent = { id: string; chainId: number; source: Source; items: IntentItem[]; createdAt: number; ref?: `0x${string}` };

/** Approves USDC if needed, then buys the whole basket in one ScrollBasket call. */
export async function buyIntent(account: LocalAccount, intent: Intent, onStep?: (s: string) => void) {
  if (intent.chainId !== chain.id) throw new Error(`Intent is for chain ${intent.chainId}`);
  const basket = need("ScrollBasket"), usdc = need("MockUSDC");
  const amounts = intent.items.map((i) => BigInt(i.usdc));
  const total = amounts.reduce((a, b) => a + b, 0n);
  const wc = walletClient(account);
  const allowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [account.address, basket] });
  if (allowance < total) {
    onStep?.("Approving USDC…");
    const h = await wc.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [basket, 2n ** 255n], gas: 80_000n });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
  onStep?.("Buying…");
  const stocks = intent.items.map((i) => i.stock);
  const minOuts = intent.items.map(() => 0n); // testnet only, per PRD
  const source = SOURCE_ID[intent.source] ?? 0;
  const ref = intent.source === "COPY" ? intent.ref : undefined;
  if (intent.source === "COPY" && !ref) throw new Error("Copy buy needs the copied wallet");
  const hash = intent.items.length === 1 && !ref
    ? await wc.writeContract({ address: basket, abi: scrollBasketAbi, functionName: "buy", args: [stocks[0], amounts[0], 0n, source], gas: 400_000n })
    : await wc.writeContract({ address: basket, abi: scrollBasketAbi, functionName: "buyBasket", args: [stocks, amounts, minOuts, source, ref ?? "0x0000000000000000000000000000000000000000"], gas: BigInt(250_000 + 200_000 * stocks.length) });
  return hash;
}

/** What a confirmed buy actually delivered, read from ScrollBasket's ScrollBuy events. */
export function boughtFromReceipt(rcpt: TransactionReceipt): { ticker: string; usd: number; shares: number }[] {
  const byAddr = Object.fromEntries(STOCK_TICKERS.map((t) => [ADDRESSES[t].toLowerCase(), t]));
  return parseEventLogs({ abi: scrollBasketAbi, eventName: "ScrollBuy", logs: rcpt.logs })
    .map((l) => ({
      ticker: byAddr[l.args.stock.toLowerCase()] ?? l.args.stock,
      usd: Number(formatUnits(l.args.usdc, 6)),
      shares: Number(formatUnits(l.args.out, 18)),
    }));
}

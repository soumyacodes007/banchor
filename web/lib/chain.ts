"use client";
import { createPublicClient, createWalletClient, http, type LocalAccount, formatUnits, parseUnits } from "viem";
import { chain, RPC_URL, ADDRESSES } from "./config";
import { erc20Abi, mockUsdcAbi, scrollBasketAbi, SOURCE_ID, type Source } from "./abi";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
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

export async function stockBalances(address: `0x${string}`): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const tickers = Object.keys(ADDRESSES).filter((k) => k !== "MockUSDC" && k !== "ScrollBasket" && !k.startsWith("Kuru") && !k.endsWith("Router") && !k.endsWith("Factory"));
  await Promise.all(tickers.map(async (t) => {
    try {
      const raw = await publicClient.readContract({ address: ADDRESSES[t], abi: erc20Abi, functionName: "balanceOf", args: [address] });
      out[t] = Number(formatUnits(raw, 18));
    } catch { /* not an ERC-20 */ }
  }));
  return out;
}

// Monad charges the declared gas limit, so set explicit, generous-but-bounded limits.
export async function topUp(account: LocalAccount, usd = 50) {
  const hash = await walletClient(account).writeContract({
    address: need("MockUSDC"), abi: mockUsdcAbi, functionName: "faucet", args: [parseUnits(String(usd), 6)], gas: 120_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export type IntentItem = { ticker: string; stock: `0x${string}`; usdc: string; usd: number };
export type Intent = { id: string; chainId: number; source: Source; items: IntentItem[]; createdAt: number };

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
  const hash = intent.items.length === 1
    ? await wc.writeContract({ address: basket, abi: scrollBasketAbi, functionName: "buy", args: [stocks[0], amounts[0], 0n, source], gas: 400_000n })
    : await wc.writeContract({ address: basket, abi: scrollBasketAbi, functionName: "buyBasket", args: [stocks, amounts, minOuts, source], gas: BigInt(250_000 + 200_000 * stocks.length) });
  return hash;
}

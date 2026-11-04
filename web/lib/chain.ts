"use client";
import { createPublicClient, createWalletClient, http, type LocalAccount, formatUnits } from "viem";
import { chain, RPC_URL, ADDRESSES, STOCK_TICKERS } from "./config";
import { erc20Abi, mockUsdcAbi, routerAbi, scrollBasketAbi, sellDeskAbi, SOURCE_ID, type Source } from "./abi";

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
  await Promise.all(STOCK_TICKERS.map(async (t) => {
    try {
      const raw = await publicClient.readContract({ address: ADDRESSES[t], abi: erc20Abi, functionName: "balanceOf", args: [address] });
      out[t] = Number(formatUnits(raw, 18));
    } catch { /* not an ERC-20 */ }
  }));
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

export type IntentItem = { ticker: string; stock: `0x${string}`; usdc: string; usd: number; sellAll?: boolean };
export type Intent = { id: string; chainId: number; source: Source; side?: "BUY" | "SELL"; items: IntentItem[]; createdAt: number; ref?: `0x${string}` };

/** Approves the stock if needed, then sells it back at the router's price. */
export async function sellIntent(account: LocalAccount, intent: Intent, onStep?: (s: string) => void) {
  if (intent.chainId !== chain.id) throw new Error(`Intent is for chain ${intent.chainId}`);
  const desk = need("MockSellDesk"), router = need("router");
  const item = intent.items[0];
  const wc = walletClient(account);
  const [balance, price] = await Promise.all([
    publicClient.readContract({ address: item.stock, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: router, abi: routerAbi, functionName: "prices", args: [item.stock] }),
  ]);
  const wanted = item.sellAll ? balance : (BigInt(item.usdc) * 10n ** 18n) / price;
  const amount = wanted > balance ? balance : wanted;
  if (amount === 0n) throw new Error(`You don't hold any ${item.ticker}.`);
  const allowance = await publicClient.readContract({ address: item.stock, abi: erc20Abi, functionName: "allowance", args: [account.address, desk] });
  if (allowance < amount) {
    onStep?.("Approving…");
    const h = await wc.writeContract({ address: item.stock, abi: erc20Abi, functionName: "approve", args: [desk, 2n ** 255n], gas: 80_000n });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
  onStep?.("Selling…");
  // The desk may need extra faucet calls for a big sale, so leave room for them.
  const faucetCalls = BigInt(Math.ceil(item.usd / FAUCET_USD));
  return wc.writeContract({ address: desk, abi: sellDeskAbi, functionName: "sell", args: [item.stock, amount, 0n], gas: 300_000n + 80_000n * faucetCalls });
}

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

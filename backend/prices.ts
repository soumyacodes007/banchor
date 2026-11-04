// Sets router prices from real closes. Run by hand on demo morning:
//
//   npm run prices -- --dry-run
//   npm run prices
//
// To set a price yourself, say if Yahoo is down: npm run prices -- METAx=612.40
//
// This holds the deployer key, so the server never imports it.
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadAddresses, ROUTER_ABI, rpcTransport } from "./chain.ts";

/** Yahoo's symbol is the ticker without the trailing x. */
function yahooSymbol(ticker: string): string {
  return ticker.slice(0, -1);
}

/** The latest daily close. Yahoo needs no key, but refuses a blank user agent. */
export async function fetchClose(symbol: string): Promise<number> {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`,
    { headers: { "user-agent": "Mozilla/5.0" } },
  );
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
  const data = (await response.json()) as {
    chart: {
      result?: { indicators: { quote: { close: (number | null)[] }[] } }[];
    };
  };
  const closes = data.chart.result?.[0]?.indicators.quote[0]?.close ?? [];
  const close = closes.filter((value) => value !== null).at(-1);
  if (close === undefined) throw new Error(`${symbol}: no close in the response`);
  return close;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const addresses = loadAddresses(
    process.env.ADDRESSES_PATH ?? join(import.meta.dirname, "addresses.json"),
  );
  const listed = Object.keys(addresses.stocks);

  const overrides = new Map(
    args
      .filter((arg) => arg.includes("="))
      .map((arg) => {
        const [ticker, price] = arg.split("=") as [string, string];
        if (!listed.includes(ticker)) throw new Error(`Unknown ticker: ${ticker}`);
        if (!(Number(price) > 0)) throw new Error(`Bad price: ${arg}`);
        return [ticker, Number(price)];
      }),
  );

  // Naming stocks by hand sets only those, so Yahoo being down can't block it.
  const tickers = overrides.size > 0 ? [...overrides.keys()] : listed;
  const prices = await Promise.all(
    tickers.map(async (ticker) => ({
      ticker,
      dollars: overrides.get(ticker) ?? (await fetchClose(yahooSymbol(ticker))),
    })),
  );

  const rpcUrls = (process.env.RPC_URLS ?? "https://testnet-rpc.monad.xyz").split(
    ",",
  );
  const chain = defineChain({
    id: addresses.chainId,
    name: "monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: rpcUrls } },
  });
  const transport = rpcTransport(rpcUrls);
  const client = createPublicClient({ chain, transport });

  const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!dryRun && key === undefined) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required, or pass --dry-run");
  }
  const wallet =
    key === undefined
      ? undefined
      : createWalletClient({
          account: privateKeyToAccount(key),
          chain,
          transport,
        });

  for (const { ticker, dollars } of prices) {
    const price = parseUnits(dollars.toFixed(2), 6);
    console.log(`${ticker}: $${dollars.toFixed(2)}`);
    if (dryRun || wallet === undefined) continue;
    const hash = await wallet.writeContract({
      address: addresses.router,
      abi: ROUTER_ABI,
      functionName: "setPrice",
      args: [addresses.stocks[ticker]!, price],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${ticker}: setPrice reverted in ${hash}`);
    }
  }
  console.log(dryRun ? "Dry run: nothing was sent." : "Prices updated.");
}

if (import.meta.main) await main();

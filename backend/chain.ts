import { readFileSync } from "node:fs";
import {
  type Abi,
  type Address,
  createPublicClient,
  fallback,
  http,
  parseAbi,
  type PublicClient,
} from "viem";

export type Addresses = {
  chainId: number;
  deployBlock: number;
  usdc: Address;
  router: Address;
  venue: Address;
  basket: Address;
  factory: Address;
  stocks: Record<string, Address>;
};

export type Holding = {
  ticker: string;
  address: Address;
  balance: bigint;
  /** USDC micro-dollars per whole stock. */
  price: bigint;
  usdValue: bigint;
};

/** What the API needs from the chain, which tests can replace. */
export type Chain = {
  addresses: Addresses;
  readPrices(): Promise<Record<string, bigint>>;
  readPortfolio(address: Address): Promise<Holding[]>;
};

export const ROUTER_ABI = parseAbi([
  "function prices(address stock) view returns (uint256)",
  "function setPrice(address stock, uint256 price)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

/** Prices move once a day, and every highlight card asks for them. */
const PRICE_CACHE_MS = 15_000;
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

type Read = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly [Address];
};

export function loadAddresses(path: string): Addresses {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Addresses;
  } catch {
    throw new Error(
      `No contract addresses at ${path}. Deploy first: see backend/README.md`,
    );
  }
}

/**
 * One or more RPCs, tried in order, so a rate-limited one can't stop the demo.
 * No JSON-RPC batching: Monad's public RPC refuses it with a 403.
 */
export function rpcTransport(urls: string[]) {
  return fallback(urls.map((url) => http(url, { timeout: 10_000 })));
}

export function createClient(rpcUrls: string[]): PublicClient {
  return createPublicClient({ transport: rpcTransport(rpcUrls) });
}

export function createChain(addresses: Addresses, client: PublicClient): Chain {
  const entries = Object.entries(addresses.stocks);
  let cached: { at: number; prices: Record<string, bigint> } | undefined;
  let hasMulticall: Promise<boolean> | undefined;

  /**
   * Reads many values in one call. Public RPCs rate-limit a burst of 20 reads,
   * so a portfolio has to be one request. Local chains have no Multicall3, and
   * read one at a time instead.
   */
  async function readAll(calls: Read[]): Promise<bigint[]> {
    hasMulticall ??= client
      .getCode({ address: MULTICALL3 })
      .then((code) => code !== undefined && code !== "0x");
    if (await hasMulticall) {
      const results = await client.multicall({
        contracts: calls,
        multicallAddress: MULTICALL3,
        allowFailure: false,
      });
      return results as bigint[];
    }
    const results: bigint[] = [];
    for (const call of calls) {
      results.push((await client.readContract(call)) as bigint);
    }
    return results;
  }

  async function readPrices(): Promise<Record<string, bigint>> {
    if (cached !== undefined && Date.now() - cached.at < PRICE_CACHE_MS) {
      return cached.prices;
    }
    const values = await readAll(
      entries.map(([, address]) => ({
        address: addresses.router,
        abi: ROUTER_ABI,
        functionName: "prices",
        args: [address],
      })),
    );
    const prices = Object.fromEntries(
      entries.map(([ticker], index) => [ticker, values[index]!]),
    );
    cached = { at: Date.now(), prices };
    return prices;
  }

  return {
    addresses,
    readPrices,

    async readPortfolio(owner) {
      const [prices, balances] = await Promise.all([
        readPrices(),
        readAll(
          entries.map(([, address]) => ({
            address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [owner],
          })),
        ),
      ]);
      return entries.map(([ticker, address], index) => {
        const balance = balances[index]!;
        const price = prices[ticker]!;
        return {
          ticker,
          address,
          balance,
          price,
          usdValue: (balance * price) / 10n ** 18n,
        };
      });
    },
  };
}

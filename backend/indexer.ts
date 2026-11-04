import {
  type Address,
  parseAbiItem,
  type PublicClient,
  zeroAddress,
} from "viem";
import { SOURCES } from "./basket.ts";
import type { Addresses } from "./chain.ts";
import type { Buy, Store } from "./store.ts";

const SCROLL_BUY = parseAbiItem(
  "event ScrollBuy(address indexed user, address indexed stock, uint256 usdc, uint256 out, uint8 indexed source, address ref)",
);

/** Public RPCs cap eth_getLogs ranges, so the indexer stays under the limit. */
const MAX_LOG_RANGE = 100n;
/** Paces catching up after a restart, which public RPCs otherwise rate-limit. */
const CATCH_UP_DELAY_MS = 250;

/**
 * Copies ScrollBuy events into the store, so every number the app shows can be
 * recomputed from the chain. Nothing here takes a client's word for a buy.
 */
export function createIndexer(params: {
  client: PublicClient;
  addresses: Addresses;
  store: Store;
}) {
  const { client, addresses, store } = params;
  const tickerOf = new Map(
    Object.entries(addresses.stocks).map(([ticker, address]) => [
      address.toLowerCase(),
      ticker,
    ]),
  );
  const blockTimes = new Map<bigint, number>();

  async function blockTime(blockNumber: bigint): Promise<number> {
    let time = blockTimes.get(blockNumber);
    if (time === undefined) {
      const block = await client.getBlock({ blockNumber });
      time = Number(block.timestamp);
      blockTimes.clear();
      blockTimes.set(blockNumber, time);
    }
    return time;
  }

  /** Indexes one range of blocks. Returns true once it has reached the tip. */
  async function step(): Promise<boolean> {
    const fromBlock = store.readCursor() ?? BigInt(addresses.deployBlock);
    // viem caches this for 4 seconds by default, which is far too stale here.
    const latest = await client.getBlockNumber({ cacheTime: 0 });
    if (latest < fromBlock) return true;
    const last = fromBlock + MAX_LOG_RANGE - 1n;
    const toBlock = last < latest ? last : latest;

    const logs = await client.getLogs({
      address: addresses.basket,
      event: SCROLL_BUY,
      fromBlock,
      toBlock,
    });

    const buys: Buy[] = [];
    for (const log of logs) {
      const { user, stock, usdc, out, source, ref } = log.args;
      const ticker = tickerOf.get((stock as Address).toLowerCase());
      // A stock listed after this deploy still counts, under its address.
      buys.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        user: user!,
        ticker: ticker ?? stock!,
        usdc: usdc!,
        out: out!,
        source: SOURCES[source!]!,
        ref: ref === zeroAddress ? null : ref!,
        blockNumber: log.blockNumber,
        // Monad's RPC includes this on logs, which saves a round trip.
        blockTime:
          log.blockTimestamp === undefined
            ? await blockTime(log.blockNumber)
            : Number(log.blockTimestamp),
      });
    }
    store.recordBuys(buys, toBlock + 1n);
    return toBlock === latest;
  }

  return {
    step,

    /** Runs until `signal` aborts, surviving RPC errors. */
    async run(intervalMs: number, signal?: AbortSignal): Promise<void> {
      while (!signal?.aborted) {
        const caughtUp = await step().catch((error: unknown) => {
          console.error(
            "indexer step failed:",
            error instanceof Error ? error.message.split("\n")[0] : error,
          );
          return true;
        });
        const delay = caughtUp ? intervalMs : CATCH_UP_DELAY_MS;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    },
  };
}

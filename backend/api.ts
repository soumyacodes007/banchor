import { type Address, isAddress, zeroAddress } from "viem";
import {
  buildBasket,
  buildCopy,
  formatUsd,
  type Mode,
  SOURCES,
  TRACKED,
} from "./basket.ts";
import type { Chain } from "./chain.ts";
import { buildRoast } from "./roast.ts";
import { type Store, weekStart } from "./store.ts";

export type ApiOptions = {
  store: Store;
  chain: Chain;
  baselineMinutes: number;
  explorerUrl: string;
  now?: () => Date;
};

const MINUTES_IN_A_WEEK = 7 * 24 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_COPY_USD = 10;
const MAX_COPY_USD = 1_000;
const LATEST_BUYS = 20;
const MICRO = 1_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const HEADERS = {
  "content-type": "application/json",
  // The extension and the dashboard call this from different origins, and no
  // endpoint uses cookies.
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

class BadRequest extends Error {}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function parseAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new BadRequest("A valid wallet address is required");
  }
  return value as Address;
}

function parseMinutes(value: unknown, name: string): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequest(`${name} must map tickers to minutes`);
  }
  const minutes: Record<string, number> = {};
  for (const [ticker, amount] of Object.entries(value)) {
    if (!(TRACKED as readonly string[]).includes(ticker)) {
      throw new BadRequest(`Unknown ticker: ${ticker}`);
    }
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > MINUTES_IN_A_WEEK
    ) {
      throw new BadRequest(`${ticker} must be 0 to ${MINUTES_IN_A_WEEK} minutes`);
    }
    minutes[ticker] = amount;
  }
  return minutes;
}

function parseMode(value: string | null): Mode {
  if (value === null || value === "roast") return "roast";
  if (value === "detox") return "detox";
  throw new BadRequest("mode must be roast or detox");
}

function parseCopyUsd(value: string | null): bigint {
  const usd = value === null ? DEFAULT_COPY_USD : Number(value);
  if (!Number.isFinite(usd) || usd < 0.01 || usd > MAX_COPY_USD) {
    throw new BadRequest(`usd must be 0.01 to ${MAX_COPY_USD}`);
  }
  return BigInt(Math.round(usd * MICRO));
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequest("Body is too large");
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
  } catch {}
  throw new BadRequest("Body must be a JSON object");
}

export function createApi(options: ApiOptions) {
  const { store, chain, baselineMinutes, explorerUrl } = options;
  const now = options.now ?? (() => new Date());
  const currentWeek = () => weekStart(now());
  const txUrl = (hash: string) => `${explorerUrl}/tx/${hash}`;

  /**
   * The weekly baseline, prorated to the part of the week that has passed, so
   * Detox settles as the week goes. The extension computes it the same way.
   */
  function baselineSoFar(): number {
    const date = now();
    const start = Date.parse(`${weekStart(date)}T00:00:00Z`);
    return (baselineMinutes * (date.getTime() - start)) / WEEK_MS;
  }

  /** A basket in the shape `approve` and `buyBasket` take. */
  function basketArgs(
    items: { ticker: string; amount: bigint }[],
    source: number,
    ref: Address,
  ) {
    const total = items.reduce((sum, { amount }) => sum + amount, 0n);
    return {
      usdc: chain.addresses.usdc,
      basket: chain.addresses.basket,
      stocks: items.map(({ ticker }) => chain.addresses.stocks[ticker]),
      amounts: items.map(({ amount }) => amount.toString()),
      minOuts: items.map(() => "0"),
      source,
      ref,
      total: total.toString(),
      totalUsd: formatUsd(total),
      items: items.map(({ ticker, amount }) => ({
        ticker,
        address: chain.addresses.stocks[ticker],
        amount: amount.toString(),
        usd: formatUsd(amount),
      })),
    };
  }

  async function saveMinutes(request: Request): Promise<Response> {
    const body = await readBody(request);
    const address = parseAddress(body.address);
    const minutes = parseMinutes(body.minutes, "minutes");
    const liveMinutes = parseMinutes(body.liveMinutes, "liveMinutes");
    const week = currentWeek();
    store.saveMinutes(address, week, minutes, liveMinutes);
    return json({ address, week, minutes, liveMinutes });
  }

  function basket(address: Address, mode: Mode): Response {
    const items = buildBasket(
      store.readWeek(address, currentWeek()),
      mode,
      baselineSoFar(),
    );
    return json({
      mode,
      ...basketArgs(items, SOURCES.indexOf("SCROLL"), zeroAddress),
    });
  }

  async function copy(address: Address, total: bigint): Promise<Response> {
    const items = buildCopy(await chain.readPortfolio(address), total);
    return json({
      copiedFrom: address,
      ...basketArgs(items, SOURCES.indexOf("COPY"), address),
    });
  }

  async function portfolio(address: Address): Promise<Response> {
    const holdings = (await chain.readPortfolio(address))
      .filter(({ balance }) => balance > 0n)
      .sort((a, b) => (a.usdValue > b.usdValue ? -1 : 1));
    const total = holdings.reduce((sum, { usdValue }) => sum + usdValue, 0n);
    return json({
      // The extension looks a stock up by ticker and reads `usd` as a number.
      ...Object.fromEntries(
        holdings.map(({ ticker, usdValue }) => [
          ticker,
          { usd: Number(usdValue) / MICRO },
        ]),
      ),
      address,
      totalUsd: formatUsd(total),
      holdings: holdings.map((holding) => ({
        ticker: holding.ticker,
        address: holding.address,
        balance: holding.balance.toString(),
        price: holding.price.toString(),
        usdValue: holding.usdValue.toString(),
        usd: formatUsd(holding.usdValue),
      })),
    });
  }

  /** Dollars per share by ticker, as the highlight card reads them. */
  async function prices(): Promise<Response> {
    const values = await chain.readPrices();
    return json(
      Object.fromEntries(
        Object.entries(values).map(([ticker, price]) => [
          ticker,
          Number(price) / MICRO,
        ]),
      ),
    );
  }

  function roast(address: Address): Response {
    const week = currentWeek();
    const txHash = store.latestBuy(address);
    return json({
      address,
      week,
      ...buildRoast({
        week: store.readWeek(address, week),
        baselineMinutes: baselineSoFar(),
        topHighlight: store.topHighlight(address),
        copyCount: store.copyCount(address),
      }),
      txHash: txHash ?? null,
      txUrl: txHash === undefined ? null : txUrl(txHash),
    });
  }

  function stats(): Response {
    const { latest, ...totals } = store.stats(now(), LATEST_BUYS);
    return json({
      ...totals,
      latest: latest.map((buy) => ({
        user: buy.user,
        ticker: buy.ticker,
        usd: formatUsd(BigInt(buy.usdc)),
        source: buy.source,
        blockTime: buy.block_time,
        txHash: buy.tx_hash,
        txUrl: txUrl(buy.tx_hash),
      })),
    });
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, api, resource, param] = url.pathname.split("/");
    const { method } = request;

    if (method === "OPTIONS") return new Response(null, { headers: HEADERS });
    if (url.pathname === "/health") {
      return json({
        ok: true,
        indexedBlock: store.readCursor()?.toString() ?? null,
      });
    }
    if (api !== "api") return json({ error: "Not found" }, 404);

    if (method === "POST" && resource === "minutes") return saveMinutes(request);

    if (method === "GET") {
      if (resource === "stats") return stats();
      if (resource === "prices") return prices();
      if (param !== undefined) {
        const address = parseAddress(param);
        if (resource === "basket") {
          return basket(address, parseMode(url.searchParams.get("mode")));
        }
        if (resource === "copy") {
          return copy(address, parseCopyUsd(url.searchParams.get("usd")));
        }
        if (resource === "portfolio") return portfolio(address);
        if (resource === "roast") return roast(address);
      }
    }
    return json({ error: "Not found" }, 404);
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof BadRequest) {
        return json({ error: error.message }, 400);
      }
      console.error("request failed", error);
      return json({ error: "Internal error" }, 500);
    }
  };
}

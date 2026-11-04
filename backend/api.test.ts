import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type ApiOptions, createApi } from "./api.ts";
import {
  buildBasket,
  buildCopy,
  formatUsd,
  type Source,
  type Week,
} from "./basket.ts";
import type { Chain } from "./chain.ts";
import { Store, weekStart } from "./store.ts";

const USER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NOW = new Date("2026-11-04T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;
/** Thursday noon is half way through the week, so this prorates to 1,200. */
const HALF_WEEK = {
  now: () => new Date("2026-11-05T12:00:00Z"),
  baselineMinutes: 2400,
};
const STOCKS = {
  METAx: "0x0000000000000000000000000000000000000001",
  GOOGLx: "0x0000000000000000000000000000000000000002",
  SPYx: "0x0000000000000000000000000000000000000005",
  NVDAx: "0x0000000000000000000000000000000000000006",
} as const;

function fakeChain() {
  return {
    addresses: {
      chainId: 10143,
      usdc: "0x00000000000000000000000000000000000000aa",
      router: "0x00000000000000000000000000000000000000bb",
      basket: "0x00000000000000000000000000000000000000cc",
      stocks: STOCKS,
    },
    readPrices: async () => ({ METAx: 600_000_000n, NVDAx: 200_000_000n }),
    readPortfolio: async () => [
      {
        ticker: "METAx",
        address: STOCKS.METAx,
        balance: 14n * 10n ** 15n,
        price: 600_000_000n,
        usdValue: 8_400_000n,
      },
      {
        ticker: "GOOGLx",
        address: STOCKS.GOOGLx,
        balance: 0n,
        price: 180_000_000n,
        usdValue: 0n,
      },
      {
        ticker: "NVDAx",
        address: STOCKS.NVDAx,
        balance: 8n * 10n ** 15n,
        price: 200_000_000n,
        usdValue: 1_600_000n,
      },
    ],
  } as unknown as Chain;
}

let hashes = 0;
function buy(
  store: Store,
  partial: {
    user?: string;
    ticker?: string;
    usdc: bigint;
    source: Source;
    ref?: string;
    blockTime?: number;
    txHash?: string;
    logIndex?: number;
  },
) {
  store.recordBuys(
    [
      {
        txHash: partial.txHash ?? `0x${String(++hashes).padStart(64, "0")}`,
        logIndex: partial.logIndex ?? 0,
        user: partial.user ?? USER,
        ticker: partial.ticker ?? "METAx",
        usdc: partial.usdc,
        out: 1n,
        source: partial.source,
        ref: partial.ref ?? null,
        blockNumber: 100n,
        blockTime: partial.blockTime ?? NOW_SECONDS,
      },
    ],
    101n,
  );
}

function setup(options: Partial<ApiOptions> = {}) {
  const store = options.store ?? new Store(":memory:");
  const handle = createApi({
    chain: fakeChain(),
    baselineMinutes: 1200,
    explorerUrl: "https://explorer.test",
    now: () => NOW,
    ...options,
    store,
  });
  const call = async (path: string, body?: unknown) => {
    const response = await handle(
      new Request(`http://test${path}`, {
        method: body === undefined ? "GET" : "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as any };
  };
  return { call, store };
}

const week = (partial: Partial<Week>): Week => ({
  minutes: {},
  liveMinutes: {},
  spent: {},
  ...partial,
});

describe("buy amounts", () => {
  test("840 minutes buys the PRD's $8.40 of Meta", () => {
    const [item] = buildBasket(week({ minutes: { METAx: 840 } }), "roast", 1200);
    assert.equal(item?.ticker, "METAx");
    assert.equal(formatUsd(item!.amount), "$8.40");
  });

  test("20 live seconds is the badge's $0.33, on top of normal minutes", () => {
    const seconds = 20 / 60;
    const live = buildBasket(
      week({ liveMinutes: { METAx: seconds } }),
      "roast",
      1200,
    );
    assert.equal(formatUsd(live[0]!.amount), "$0.33");
    const both = buildBasket(
      week({ minutes: { METAx: 840 }, liveMinutes: { METAx: seconds } }),
      "roast",
      1200,
    );
    assert.equal(formatUsd(both[0]!.amount), "$8.73");
  });

  test("detox: 6 hours under baseline is the PRD's $3.60 of SPYx", () => {
    const items = buildBasket(week({ minutes: { METAx: 840 } }), "detox", 1200);
    assert.deepEqual(
      items.map(({ ticker }) => ticker),
      ["SPYx"],
    );
    assert.equal(formatUsd(items[0]!.amount), "$3.60");
  });

  test("detox buys nothing over baseline", () => {
    const items = buildBasket(week({ minutes: { METAx: 1300 } }), "detox", 1200);
    assert.deepEqual(items, []);
  });

  test("x.com time counts against detox but never buys a stock", () => {
    const roast = buildBasket(week({ minutes: { X: 360 } }), "roast", 1200);
    assert.deepEqual(roast, []);
    const detox = buildBasket(week({ minutes: { X: 360 } }), "detox", 1200);
    assert.equal(formatUsd(detox[0]!.amount), "$8.40");
  });

  test("skips stocks under a cent", () => {
    assert.deepEqual(
      buildBasket(week({ minutes: { METAx: 0.5 } }), "roast", 1200),
      [],
    );
    assert.equal(
      buildBasket(week({ minutes: { METAx: 1 } }), "roast", 1200).length,
      1,
    );
  });

  test("orders the basket biggest first", () => {
    const items = buildBasket(
      week({ minutes: { GOOGLx: 300, METAx: 840 } }),
      "roast",
      1200,
    );
    assert.deepEqual(
      items.map(({ ticker }) => ticker),
      ["METAx", "GOOGLx"],
    );
  });
});

describe("buildCopy", () => {
  test("keeps the proportions and spends exactly the total", () => {
    const items = buildCopy(
      [
        { ticker: "METAx", usdValue: 3_000_000n },
        { ticker: "NVDAx", usdValue: 1_000_000n },
      ],
      10_000_000n,
    );
    assert.deepEqual(items, [
      { ticker: "METAx", amount: 7_500_000n },
      { ticker: "NVDAx", amount: 2_500_000n },
    ]);
  });

  test("rounding leftovers still add up to the total", () => {
    const items = buildCopy(
      [
        { ticker: "A", usdValue: 1n },
        { ticker: "B", usdValue: 1n },
        { ticker: "C", usdValue: 1n },
      ],
      10_000_000n,
    );
    const total = items.reduce((sum, { amount }) => sum + amount, 0n);
    assert.equal(total, 10_000_000n);
  });

  test("drops slivers and empty holdings, and an empty wallet copies nothing", () => {
    const items = buildCopy(
      [
        { ticker: "BIG", usdValue: 100_000_000n },
        { ticker: "DUST", usdValue: 1n },
        { ticker: "NONE", usdValue: 0n },
      ],
      1_000_000n,
    );
    assert.deepEqual(
      items.map(({ ticker }) => ticker),
      ["BIG"],
    );
    assert.equal(items[0]!.amount, 1_000_000n);
    assert.deepEqual(buildCopy([{ ticker: "A", usdValue: 0n }], 1n), []);
  });
});

describe("weekStart", () => {
  test("uses the Monday of the week", () => {
    assert.equal(weekStart(new Date("2026-11-04T12:00:00Z")), "2026-11-02");
    assert.equal(weekStart(new Date("2026-11-02T00:00:00Z")), "2026-11-02");
    assert.equal(weekStart(new Date("2026-11-08T23:59:59Z")), "2026-11-02");
    assert.equal(weekStart(new Date("2026-11-09T00:00:00Z")), "2026-11-09");
  });
});

describe("POST /api/minutes", () => {
  test("saves totals and replaces them on the next post", async () => {
    const { call } = setup();
    await call("/api/minutes", { address: USER, minutes: { METAx: 100 } });
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    const { body } = await call(`/api/basket/${USER}`);
    assert.equal(body.totalUsd, "$8.40");
  });

  test("treats an address the same in any case", async () => {
    const { call } = setup();
    await call("/api/minutes", {
      address: USER.toLowerCase(),
      minutes: { METAx: 840 },
    });
    const { body } = await call(`/api/basket/${USER}`);
    assert.equal(body.totalUsd, "$8.40");
  });

  test("rejects bad input", async () => {
    const { call } = setup();
    const bad = [
      { minutes: { METAx: 1 } },
      { address: "nope", minutes: {} },
      { address: USER, minutes: { DOGE: 1 } },
      { address: USER, minutes: { METAx: -1 } },
      { address: USER, minutes: { METAx: 99_999 } },
      { address: USER, minutes: { METAx: "1" } },
      { address: USER, minutes: [] },
    ];
    for (const body of bad) {
      assert.equal((await call("/api/minutes", body)).status, 400);
    }
  });

  test("a new week starts empty", async () => {
    let now = NOW;
    const { call } = setup({ now: () => now });
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    now = new Date("2026-11-09T12:00:00Z");
    const { body } = await call(`/api/basket/${USER}`);
    assert.deepEqual(body.items, []);
  });
});

describe("GET /api/basket", () => {
  test("returns arguments ready for buyBasket", async () => {
    const { call } = setup();
    await call("/api/minutes", {
      address: USER,
      minutes: { METAx: 840, GOOGLx: 300 },
    });
    const { body } = await call(`/api/basket/${USER}`);
    assert.deepEqual(body.stocks, [STOCKS.METAx, STOCKS.GOOGLx]);
    assert.deepEqual(body.amounts, ["8400000", "3000000"]);
    assert.deepEqual(body.minOuts, ["0", "0"]);
    assert.equal(body.source, 0);
    assert.equal(body.total, "11400000");
  });

  test("detox mode and bad modes", async () => {
    const { call } = setup(HALF_WEEK);
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    const detox = await call(`/api/basket/${USER}?mode=detox`);
    assert.deepEqual(detox.body.stocks, [STOCKS.SPYx]);
    assert.equal((await call(`/api/basket/${USER}?mode=x`)).status, 400);
    assert.equal((await call("/api/basket/nope")).status, 400);
  });

  test("detox prorates the baseline, as the extension does", async () => {
    // Half way through the week, a 2,400 minute baseline allows 1,200 so far.
    const { call } = setup(HALF_WEEK);
    await call("/api/minutes", { address: USER, minutes: { METAx: 1100 } });
    const under = await call(`/api/basket/${USER}?mode=detox`);
    assert.equal(under.body.totalUsd, "$1.00");
    await call("/api/minutes", { address: USER, minutes: { METAx: 1300 } });
    const over = await call(`/api/basket/${USER}?mode=detox`);
    assert.deepEqual(over.body.items, []);
  });

  test("a scroll buy can't be bought twice, and new scrolling still can be", async () => {
    const { call, store } = setup();
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    buy(store, { usdc: 8_400_000n, source: "SCROLL" });
    assert.deepEqual((await call(`/api/basket/${USER}`)).body.items, []);

    await call("/api/minutes", { address: USER, minutes: { METAx: 860 } });
    assert.equal((await call(`/api/basket/${USER}`)).body.totalUsd, "$0.20");
  });

  test("a chunk bought during the week comes off the weekly basket", async () => {
    const { call, store } = setup();
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    buy(store, { usdc: 300_000n, source: "SCROLL" });
    assert.equal((await call(`/api/basket/${USER}`)).body.totalUsd, "$8.10");
  });

  test("highlight, copy and gift money never eats scroll earnings", async () => {
    const { call, store } = setup();
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    buy(store, { usdc: 5_000_000n, source: "HIGHLIGHT" });
    buy(store, { usdc: 5_000_000n, source: "COPY", ref: OTHER });
    buy(store, { usdc: 5_000_000n, source: "GIFT", ref: OTHER });
    assert.equal((await call(`/api/basket/${USER}`)).body.totalUsd, "$8.40");
  });

  test("last week's buys don't touch this week", async () => {
    const { call, store } = setup();
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    buy(store, {
      usdc: 8_400_000n,
      source: "SCROLL",
      blockTime: NOW_SECONDS - 7 * 86_400,
    });
    assert.equal((await call(`/api/basket/${USER}`)).body.totalUsd, "$8.40");
  });
});

describe("GET /api/copy", () => {
  test("mirrors a wallet's proportions, ready for buyBasket", async () => {
    const { call } = setup();
    const { body } = await call(`/api/copy/${USER}?usd=10`);
    assert.deepEqual(body.stocks, [STOCKS.METAx, STOCKS.NVDAx]);
    assert.deepEqual(body.amounts, ["8400000", "1600000"]);
    assert.equal(body.source, 2);
    assert.equal(body.ref, USER);
    assert.equal(body.totalUsd, "$10.00");
  });

  test("rejects a silly amount", async () => {
    const { call } = setup();
    assert.equal((await call(`/api/copy/${USER}?usd=0`)).status, 400);
    assert.equal((await call(`/api/copy/${USER}?usd=nope`)).status, 400);
    assert.equal((await call(`/api/copy/${USER}?usd=99999`)).status, 400);
  });
});

describe("GET /api/portfolio and /api/prices", () => {
  test("portfolio hides empty holdings and sorts by value", async () => {
    const { call } = setup();
    const { body } = await call(`/api/portfolio/${USER}`);
    assert.equal(body.totalUsd, "$10.00");
    assert.deepEqual(
      body.holdings.map(({ ticker }: any) => ticker),
      ["METAx", "NVDAx"],
    );
  });

  // These two pin the shapes extension/background.js reads.
  test("portfolio answers `portfolio[ticker].usd` with a number", async () => {
    const { call } = setup();
    const { body } = await call(`/api/portfolio/${USER}`);
    assert.equal(body.METAx.usd, 8.4);
    assert.equal(body.NVDAx.usd, 1.6);
    assert.equal(body.GOOGLx, undefined);
  });

  test("prices answer `prices[ticker]` with dollars", async () => {
    const { call } = setup();
    const { body } = await call("/api/prices");
    assert.deepEqual(body, { METAx: 600, NVDAx: 200 });
  });
});

describe("GET /api/stats", () => {
  test("counts transactions, not the events inside them", async () => {
    const { call, store } = setup();
    const txHash = `0x${"e".repeat(64)}`;
    buy(store, { usdc: 1n, source: "SCROLL", txHash, logIndex: 0 });
    buy(store, { usdc: 1n, source: "SCROLL", txHash, logIndex: 1 });
    buy(store, { usdc: 1n, source: "HIGHLIGHT", ticker: "NVDAx", user: OTHER });
    const { body } = await call("/api/stats");
    assert.equal(body.totalTransactions, 2);
    assert.equal(body.uniqueWallets, 2);
    assert.deepEqual(body.bySource, {
      SCROLL: 1,
      HIGHLIGHT: 1,
      COPY: 0,
      GIFT: 0,
    });
    assert.equal(body.latest.length, 3);
  });

  test("only today's buys count as today", async () => {
    const { call, store } = setup();
    buy(store, { usdc: 1n, source: "SCROLL" });
    buy(store, { usdc: 1n, source: "SCROLL", blockTime: NOW_SECONDS - 90_000 });
    const { body } = await call("/api/stats");
    assert.equal(body.totalTransactions, 2);
    assert.equal(body.transactionsToday, 1);
  });

  test("the same event indexed twice counts once", async () => {
    const { call, store } = setup();
    const txHash = `0x${"f".repeat(64)}`;
    buy(store, { usdc: 1n, source: "SCROLL", txHash });
    buy(store, { usdc: 1n, source: "SCROLL", txHash });
    assert.equal((await call("/api/stats")).body.latest.length, 1);
  });
});

describe("GET /api/roast", () => {
  test("says could own before a buy, and only claims it after", async () => {
    const { call, store } = setup();
    await call("/api/minutes", {
      address: USER,
      minutes: { METAx: 840, X: 360 },
    });
    const before = await call(`/api/roast/${USER}`);
    assert.equal(
      before.body.lines.headline,
      "You scrolled 20 hours this week. You could own $8.40 of Meta.",
    );
    assert.equal(before.body.txUrl, null);

    const txHash = `0x${"a".repeat(64)}`;
    buy(store, { usdc: 8_400_000n, source: "SCROLL", txHash });
    const { body } = await call(`/api/roast/${USER}`);
    assert.equal(
      body.lines.headline,
      "You scrolled 20 hours this week. You now own $8.40 of Meta.",
    );
    assert.equal(body.lines.thanks, "Mark Zuckerberg thanks you for your service.");
    assert.equal(
      body.lines.x,
      "6 hours on X. That's not even investable. Pure loss.",
    );
    assert.equal(body.txUrl, `https://explorer.test/tx/${txHash}`);
  });

  test("the PRD's detox line", async () => {
    const { call } = setup(HALF_WEEK);
    await call("/api/minutes", { address: USER, minutes: { METAx: 840 } });
    const { body } = await call(`/api/roast/${USER}`);
    assert.equal(
      body.lines.detox,
      "You scrolled 6 hours less than usual. That's $3.60 of the S&P 500.",
    );
  });

  test("the highlight line and the copy count", async () => {
    const { call, store } = setup();
    for (let index = 0; index < 3; index++) {
      buy(store, { usdc: 5n, source: "HIGHLIGHT", ticker: "NVDAx" });
    }
    const txHash = `0x${"c".repeat(64)}`;
    buy(store, { usdc: 1n, source: "COPY", user: OTHER, ref: USER, txHash });
    buy(store, {
      usdc: 1n,
      source: "COPY",
      user: OTHER,
      ref: USER,
      txHash,
      logIndex: 1,
      ticker: "NVDAx",
    });
    const { body } = await call(`/api/roast/${USER}`);
    assert.equal(
      body.lines.highlight,
      "You bought Nvidia 3 times from a highlight. Jensen thanks you too.",
    );
    assert.equal(body.copyCount, 1, "one person copying two stocks is one copy");
    assert.equal(body.lines.copies, "1 person copied this basket.");
  });

  test("an empty week doesn't crash the card", async () => {
    const { call } = setup();
    const { status, body } = await call(`/api/roast/${USER}`);
    assert.equal(status, 200);
    assert.equal(body.lines.thanks, null);
  });
});

describe("routing", () => {
  test("unknown paths are 404, and health works", async () => {
    const { call } = setup();
    assert.equal((await call("/api/nope")).status, 404);
    assert.equal((await call("/nope")).status, 404);
    assert.equal((await call("/health")).status, 200);
  });
});

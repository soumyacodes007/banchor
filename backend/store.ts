import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Source, SOURCES, type Week } from "./basket.ts";

export type Buy = {
  txHash: string;
  logIndex: number;
  user: string;
  ticker: string;
  usdc: bigint;
  out: bigint;
  source: Source;
  ref: string | null;
  blockNumber: bigint;
  /** Unix seconds. */
  blockTime: number;
};

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/** The Monday, in UTC, that starts the week containing `date`. */
export function weekStart(date: Date): string {
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function weekRange(week: string): [number, number] {
  const start = Date.parse(`${week}T00:00:00Z`) / 1000;
  return [start, start + WEEK_SECONDS];
}

type BuyRow = {
  tx_hash: string;
  user: string;
  ticker: string;
  usdc: string;
  source: Source;
  block_time: number;
};

export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS minutes (
        address TEXT NOT NULL,
        week TEXT NOT NULL,
        ticker TEXT NOT NULL,
        minutes REAL NOT NULL,
        live_minutes REAL NOT NULL,
        PRIMARY KEY (address, week, ticker)
      );
      CREATE TABLE IF NOT EXISTS buys (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        user TEXT NOT NULL,
        ticker TEXT NOT NULL,
        usdc TEXT NOT NULL,
        out TEXT NOT NULL,
        source TEXT NOT NULL,
        ref TEXT,
        block_number INTEGER NOT NULL,
        block_time INTEGER NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS buys_user ON buys (user, block_time);
      CREATE INDEX IF NOT EXISTS buys_ref ON buys (ref, source);
      CREATE TABLE IF NOT EXISTS cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        block_number INTEGER NOT NULL
      );
    `);
  }

  /** Replaces the week's totals. The extension always sends the full week. */
  saveMinutes(
    address: string,
    week: string,
    minutes: Record<string, number>,
    liveMinutes: Record<string, number>,
  ): void {
    const key = address.toLowerCase();
    const insert = this.#db.prepare(
      "INSERT INTO minutes (address, week, ticker, minutes, live_minutes) VALUES (?, ?, ?, ?, ?)",
    );
    this.#db.exec("BEGIN");
    try {
      this.#db
        .prepare("DELETE FROM minutes WHERE address = ? AND week = ?")
        .run(key, week);
      for (const ticker of new Set([
        ...Object.keys(minutes),
        ...Object.keys(liveMinutes),
      ])) {
        insert.run(
          key,
          week,
          ticker,
          minutes[ticker] ?? 0,
          liveMinutes[ticker] ?? 0,
        );
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  readWeek(address: string, week: string): Week {
    const key = address.toLowerCase();
    const [from, to] = weekRange(week);
    const rows = this.#db
      .prepare(
        "SELECT ticker, minutes, live_minutes FROM minutes WHERE address = ? AND week = ?",
      )
      .all(key, week) as {
      ticker: string;
      minutes: number;
      live_minutes: number;
    }[];
    // Only scroll buys spend scroll earnings. A highlight is extra money.
    const spentRows = this.#db
      .prepare(
        `SELECT ticker, usdc FROM buys
         WHERE user = ? AND source = 'SCROLL' AND block_time >= ? AND block_time < ?`,
      )
      .all(key, from, to) as { ticker: string; usdc: string }[];

    const result: Week = { minutes: {}, liveMinutes: {}, spent: {} };
    for (const row of rows) {
      result.minutes[row.ticker] = row.minutes;
      result.liveMinutes[row.ticker] = row.live_minutes;
    }
    // Summed here, because USDC amounts can outgrow SQLite's integers.
    for (const row of spentRows) {
      result.spent[row.ticker] =
        (result.spent[row.ticker] ?? 0n) + BigInt(row.usdc);
    }
    return result;
  }

  /** Saves indexed buys and moves the cursor together, so neither can lag. */
  recordBuys(buys: Buy[], nextBlock: bigint): void {
    const insert = this.#db.prepare(
      `INSERT OR IGNORE INTO buys
         (tx_hash, log_index, user, ticker, usdc, out, source, ref, block_number, block_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#db.exec("BEGIN");
    try {
      for (const buy of buys) {
        insert.run(
          buy.txHash.toLowerCase(),
          buy.logIndex,
          buy.user.toLowerCase(),
          buy.ticker,
          buy.usdc.toString(),
          buy.out.toString(),
          buy.source,
          buy.ref?.toLowerCase() ?? null,
          Number(buy.blockNumber),
          buy.blockTime,
        );
      }
      this.#db
        .prepare(
          `INSERT INTO cursor (id, block_number) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET block_number = excluded.block_number`,
        )
        .run(Number(nextBlock));
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  readCursor(): bigint | undefined {
    const row = this.#db
      .prepare("SELECT block_number FROM cursor WHERE id = 1")
      .get() as { block_number: number } | undefined;
    return row === undefined ? undefined : BigInt(row.block_number);
  }

  latestBuy(address: string): string | undefined {
    const row = this.#db
      .prepare(
        "SELECT tx_hash FROM buys WHERE user = ? ORDER BY block_number DESC, log_index DESC LIMIT 1",
      )
      .get(address.toLowerCase()) as { tx_hash: string } | undefined;
    return row?.tx_hash;
  }

  /** The wallets that copied this address, not the number of stocks they took. */
  copyCount(address: string): number {
    const row = this.#db
      .prepare(
        "SELECT COUNT(DISTINCT user) AS copies FROM buys WHERE ref = ? AND source = 'COPY'",
      )
      .get(address.toLowerCase()) as { copies: number };
    return row.copies;
  }

  topHighlight(address: string): { ticker: string; buys: number } | undefined {
    return this.#db
      .prepare(
        `SELECT ticker, COUNT(*) AS buys FROM buys
         WHERE user = ? AND source = 'HIGHLIGHT'
         GROUP BY ticker ORDER BY buys DESC LIMIT 1`,
      )
      .get(address.toLowerCase()) as
      | { ticker: string; buys: number }
      | undefined;
  }

  /**
   * Counts transactions, not events, so a basket of three stocks is one. These
   * can all be recomputed from ScrollBuy logs.
   */
  stats(now: Date, limit: number) {
    const dayAgo = Math.floor(now.getTime() / 1000) - DAY_SECONDS;
    const count = (sql: string, ...params: number[]) =>
      (this.#db.prepare(sql).get(...params) as { value: number }).value;

    const bySource = Object.fromEntries(
      SOURCES.map((source) => [source, 0]),
    ) as Record<Source, number>;
    const rows = this.#db
      .prepare(
        "SELECT source, COUNT(DISTINCT tx_hash) AS value FROM buys GROUP BY source",
      )
      .all() as { source: Source; value: number }[];
    for (const { source, value } of rows) bySource[source] = value;

    const latest = this.#db
      .prepare(
        `SELECT tx_hash, user, ticker, usdc, source, block_time FROM buys
         ORDER BY block_number DESC, log_index DESC LIMIT ?`,
      )
      .all(limit) as BuyRow[];

    return {
      totalTransactions: count(
        "SELECT COUNT(DISTINCT tx_hash) AS value FROM buys",
      ),
      transactionsToday: count(
        "SELECT COUNT(DISTINCT tx_hash) AS value FROM buys WHERE block_time >= ?",
        dayAgo,
      ),
      uniqueWallets: count("SELECT COUNT(DISTINCT user) AS value FROM buys"),
      bySource,
      latest,
    };
  }
}

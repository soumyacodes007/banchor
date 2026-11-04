/** Stocks that scrolling earns. x.com is tracked but has no stock. */
export const SCROLL_TICKERS = ["METAx", "GOOGLx", "NFLXx", "AMZNx"] as const;
export const DETOX_TICKER = "SPYx";

/** What the extension may report. `X` is x.com, which only feeds the roast. */
export const TRACKED = [...SCROLL_TICKERS, "X"] as const;

/** `ScrollBasket.Source`, in contract order. */
export const SOURCES = ["SCROLL", "HIGHLIGHT", "COPY", "GIFT"] as const;
export type Source = (typeof SOURCES)[number];

export type Mode = "roast" | "detox";

export type Week = {
  minutes: Record<string, number>;
  /** Minutes from Live mode, which count at the stage rate. */
  liveMinutes: Record<string, number>;
  /** USDC already spent on scroll buys this week, in micro-dollars. */
  spent: Record<string, bigint>;
};

/** $0.10 per 10 minutes, in USDC's 6 decimals. */
export const MICRO_PER_MINUTE = 10_000;
/** Live mode's $1 per minute, so the badge visibly moves in 20 seconds. */
const LIVE_MICRO_PER_MINUTE = 1_000_000;
export const MIN_BUY_MICRO = 10_000n;

export const DEFAULT_BASELINE_MINUTES = 20 * 60;

function toMicro(minutes: number, rate: number): bigint {
  return BigInt(Math.floor(minutes * rate));
}

export function totalMinutes(week: Week): number {
  const sum = (values: Record<string, number>) =>
    Object.values(values).reduce((total, value) => total + value, 0);
  return sum(week.minutes) + sum(week.liveMinutes);
}

/** What each stock's scrolling is worth, before anything already bought. */
export function roastEarned(week: Week): Record<string, bigint> {
  const earned: Record<string, bigint> = {};
  for (const ticker of SCROLL_TICKERS) {
    const micro =
      toMicro(week.minutes[ticker] ?? 0, MICRO_PER_MINUTE) +
      toMicro(week.liveMinutes[ticker] ?? 0, LIVE_MICRO_PER_MINUTE);
    if (micro > 0n) earned[ticker] = micro;
  }
  return earned;
}

export function savedMinutes(week: Week, baselineMinutes: number): number {
  return Math.max(0, baselineMinutes - totalMinutes(week));
}

export function detoxEarned(
  week: Week,
  baselineMinutes: number,
): Record<string, bigint> {
  const micro = toMicro(savedMinutes(week, baselineMinutes), MICRO_PER_MINUTE);
  return micro > 0n ? { [DETOX_TICKER]: micro } : {};
}

/**
 * What to buy now: earned minus already spent, skipping anything under a cent.
 * Subtracting spend is what stops a second tap buying the same minutes again.
 */
export function buildBasket(
  week: Week,
  mode: Mode,
  baselineMinutes: number,
): { ticker: string; amount: bigint }[] {
  const earned =
    mode === "detox" ? detoxEarned(week, baselineMinutes) : roastEarned(week);
  const items: { ticker: string; amount: bigint }[] = [];
  for (const [ticker, micro] of Object.entries(earned)) {
    const amount = micro - (week.spent[ticker] ?? 0n);
    if (amount >= MIN_BUY_MICRO) items.push({ ticker, amount });
  }
  return items.sort((a, b) => (a.amount > b.amount ? -1 : 1));
}

/**
 * Splits `total` across holdings by value, so a copy has the same proportions.
 * Whatever rounding leaves over goes to the biggest holding.
 */
export function buildCopy(
  holdings: { ticker: string; usdValue: bigint }[],
  total: bigint,
): { ticker: string; amount: bigint }[] {
  const held = holdings
    .filter(({ usdValue }) => usdValue > 0n)
    .sort((a, b) => (a.usdValue > b.usdValue ? -1 : 1));
  const value = held.reduce((sum, { usdValue }) => sum + usdValue, 0n);
  if (value === 0n) return [];

  const items = held
    .map(({ ticker, usdValue }) => ({
      ticker,
      amount: (total * usdValue) / value,
    }))
    .filter(({ amount }) => amount >= MIN_BUY_MICRO);
  const used = items.reduce((sum, { amount }) => sum + amount, 0n);
  if (items[0] !== undefined) items[0].amount += total - used;
  return items;
}

/** Formats micro-dollars as "$8.40". */
export function formatUsd(micro: bigint): string {
  const cents = micro / 10_000n;
  return `$${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

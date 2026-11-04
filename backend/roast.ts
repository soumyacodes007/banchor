import {
  formatUsd,
  MICRO_PER_MINUTE,
  roastEarned,
  SCROLL_TICKERS,
  savedMinutes,
  totalMinutes,
  type Week,
} from "./basket.ts";

const COMPANIES: Record<string, string> = {
  METAx: "Meta",
  GOOGLx: "Google",
  NFLXx: "Netflix",
  AMZNx: "Amazon",
  SPYx: "the S&P 500",
  NVDAx: "Nvidia",
  TSLAx: "Tesla",
  AAPLx: "Apple",
  MSFTx: "Microsoft",
  AMDx: "AMD",
  COINx: "Coinbase",
  MSTRx: "Strategy",
  PLTRx: "Palantir",
  HOODx: "Robinhood",
  INTCx: "Intel",
  ORCLx: "Oracle",
  UBERx: "Uber",
  DISx: "Disney",
  SHOPx: "Shopify",
  BABAx: "Alibaba",
};

const THANKS: Record<string, string> = {
  METAx: "Mark Zuckerberg thanks you for your service.",
};
const DEFAULT_THANKS = "Your attention has been processed.";
const HIGHLIGHT_THANKS: Record<string, string> = {
  NVDAx: " Jensen thanks you too.",
};

function hours(minutes: number): string {
  const rounded = Math.round((minutes / 60) * 10) / 10;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
}

function times(count: number): string {
  return count === 1 ? "once" : `${count} times`;
}

export type RoastInput = {
  week: Week;
  baselineMinutes: number;
  /** The stock this user bought most from highlights. */
  topHighlight: { ticker: string; buys: number } | undefined;
  copyCount: number;
};

/** The roast card's numbers and copy, shared by the page and its share image. */
export function buildRoast(input: RoastInput) {
  const { week, baselineMinutes, topHighlight, copyCount } = input;
  const earned = roastEarned(week);
  const stocks = SCROLL_TICKERS.map((ticker) => {
    const minutes =
      (week.minutes[ticker] ?? 0) + (week.liveMinutes[ticker] ?? 0);
    const owned = week.spent[ticker] ?? 0n;
    const worth = earned[ticker] ?? 0n;
    return {
      ticker,
      company: COMPANIES[ticker]!,
      minutes,
      owned,
      worth,
    };
  })
    .filter(({ minutes }) => minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const top = stocks[0];
  const scrolled = hours(totalMinutes(week));
  // "You now own" must stay true before the first buy.
  const headline =
    top === undefined
      ? "Nothing scrolled yet this week. Suspicious."
      : top.owned > 0n
        ? `You scrolled ${scrolled} this week. You now own ${formatUsd(top.owned)} of ${top.company}.`
        : `You scrolled ${scrolled} this week. You could own ${formatUsd(top.worth)} of ${top.company}.`;

  const xMinutes = (week.minutes.X ?? 0) + (week.liveMinutes.X ?? 0);
  const saved = savedMinutes(week, baselineMinutes);
  const savedMicro = BigInt(Math.floor(saved * MICRO_PER_MINUTE));

  return {
    scrolledMinutes: totalMinutes(week),
    xMinutes,
    savedMinutes: saved,
    copyCount,
    topHighlight: topHighlight ?? null,
    stocks: stocks.map(({ ticker, company, minutes, owned, worth }) => ({
      ticker,
      company,
      minutes,
      ownedUsd: formatUsd(owned),
      readyUsd: formatUsd(worth > owned ? worth - owned : 0n),
    })),
    lines: {
      headline,
      thanks: top === undefined ? null : (THANKS[top.ticker] ?? DEFAULT_THANKS),
      highlight:
        topHighlight === undefined
          ? null
          : `You bought ${COMPANIES[topHighlight.ticker] ?? topHighlight.ticker} ${times(topHighlight.buys)} from a highlight.${HIGHLIGHT_THANKS[topHighlight.ticker] ?? ""}`,
      x:
        xMinutes > 0
          ? `${hours(xMinutes)} on X. That's not even investable. Pure loss.`
          : null,
      detox:
        saved > 0
          ? `You scrolled ${hours(saved)} less than usual. That's ${formatUsd(savedMicro)} of the S&P 500.`
          : null,
      copies:
        copyCount > 0
          ? `${copyCount} ${copyCount === 1 ? "person" : "people"} copied this basket.`
          : null,
    },
  };
}

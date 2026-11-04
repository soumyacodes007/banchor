# Doomscroll Dividends: backend and contracts

The contracts are live on Monad testnet (chain 10143). All addresses are in [`addresses.json`](addresses.json), which is safe to paste into the extension's Settings as it is.

| Contract | Address |
| --- | --- |
| MockUSDC | `0xB5CC9995a1ddbdED596804af5B59B452cEc70D40` |
| ScrollBasket | `0x1d775CF873c2783D1e0FE6a20e0966548A827BA7` |
| MockRouter | `0xb361cc73B5813338E661e1c373433F04aFc82C80` |
| MockVenue | `0x400a452B564eA24332e8E1a10065355D7837Ea57` |
| StockFactory | `0x70Ae475Fbf221e90ee51BbE6427F97f27EAf6080` |

There are 20 stocks, listed at their Nov 3, 2026 closes. The deployer owns the router, factory and basket.

## Live backend

https://backend-production-1dd0.up.railway.app

It runs on Railway as project `doomscroll-dividends`, service `backend`, with the database on a volume at `/data`. To deploy from this folder:

```bash
railway up . --path-as-root --service backend --detach
```

From Git Bash, set `MSYS_NO_PATHCONV=1` before any Railway command with a `/path` in it, or the path gets rewritten. Railway stops reading `railway.json` on 2026-12-01, so run `railway config migrate` if this outlives the hackathon.

## Run it

Needs Node 24 or later.

```bash
npm install
npm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | |
| `RPC_URLS` | Monad, Ankr, Monad Infra | Comma separated, tried in order |
| `DB_PATH` | `data/doomscroll.sqlite` | Put this on a persistent volume when hosted. A lost database rebuilds buys from the chain, but not minutes |
| `DETOX_BASELINE_MINUTES` | `1200` | Weekly baseline |
| `ADDRESSES_PATH` | `addresses.json` | |
| `OPENROUTER_API_KEY` | none | Turns on live analysis. Without it, only the demo article works |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` | |

The server holds no keys. Only `prices.ts` does, and the server never imports it.

```bash
npm test
npm run prices -- --dry-run
npm run prices
npm run prices -- METAx=612.40
```

`npm run prices` reads the deployer key from `contracts/.env`, which is gitignored. The last command sets one price by hand, in case Yahoo is down.

`e2e.ts` runs every buy loop through the real server. Its header has the commands for a local chain and for testnet.

## API

CORS is open and there's no auth, so anyone can post minutes for any address. That's acceptable for a demo where the backend holds nothing of value, but it needs signed requests before a real launch.

| Endpoint | Returns |
| --- | --- |
| `POST /api/minutes` | Takes `{ address, minutes, liveMinutes? }` and replaces the week's totals. Tickers are `METAx`, `GOOGLx`, `NFLXx`, `AMZNx` and `X` |
| `GET /api/basket/:address?mode=roast\|detox` | Arguments for `buyBasket`, minus anything already bought this week |
| `GET /api/copy/:address?usd=10` | Arguments for `buyBasket` that mirror a wallet's proportions, with `source` and `ref` set for a copy |
| `GET /api/portfolio/:address` | `{ METAx: { usd: 8.4 }, totalUsd, holdings: [...] }` |
| `GET /api/prices` | `{ NVDAx: 206.69, ... }`, dollars per share, cached for 15 seconds |
| `GET /api/roast/:address` | Card numbers, plus ready-made copy in `lines` |
| `GET /api/stats` | `totalTransactions`, `transactionsToday`, `uniqueWallets`, `bySource`, and the 20 latest buys |
| `POST /api/analyze` | Takes `{ url, title, text }` and returns `{ headline, summary, picks, source }`, or a 503 if the page can't be analyzed |
| `GET /health` | `{ ok, indexedBlock }` |

Buys are never reported to the backend. `indexer.ts` reads `ScrollBuy` events from the chain about every 500 ms, so every number here can be recomputed from the chain.

## Analyze

The extension's Analyze button sends the open page here. `analyze.ts` asks a model through OpenRouter for a buy idea, and always returns a `source` so the UI can say which it was.

The demo article is [NVIDIA and Palantir Cool Off in 2026](https://www.nasdaq.com/articles/nvidia-and-palantir-cool-2026-concerning). If OpenRouter has no key, fails or returns nothing usable, that one article gets a saved analysis written from its real numbers, with `source: "saved"`. Any other page gets a 503 rather than an invented answer.

Article text is untrusted, since a page can carry instructions aimed at the model. So `cleanAnalysis` keeps only listed tickers, snaps amounts to $1, $5 or $20, and allows at most three picks. A suggestion is only ever a suggestion: buying is a separate tap, confirmed on the dashboard.

The endpoint is public and each call costs OpenRouter credit, so results are cached for an hour and calls are capped at 20 a minute. Set a spending limit on the key as well.

## Calling the contracts

```solidity
// source: 0 SCROLL, 1 HIGHLIGHT, 2 COPY, 3 GIFT
ScrollBasket.buy(stock, amount, minOut, source)                  // SCROLL or HIGHLIGHT
ScrollBasket.buyBasket(stocks, amounts, minOuts, source, ref)    // ref is set only for COPY
ScrollBasket.buyFor(to, stock, amount, minOut)                   // a gift
MockUSDC.faucet()                                                // mints 1,000
```

Approve MockUSDC to ScrollBasket first. `buyBasket` takes a `ref` argument the PRD doesn't list, because a copy has to name whose card it copied. The contract refuses a `ref` on anything but a copy, so referral counts can't be faked with a normal buy.

`ScrollBuy` fires once per stock, so count distinct transactions, not events. For a gift, `ref` is the recipient.

## Things that will bite you on Monad

Each of these came from running against real testnet. A local chain shows none of them.

- **A freshly funded wallet can't spend straight away.** Monad executes a few blocks behind consensus, so it fails with "insufficient balance" for a moment. Sponsored passkey accounts shouldn't hit this, but anything paying its own gas will.
- **The public RPC refuses JSON-RPC batches** with a 403, so don't turn on viem's `batch` option.
- **The public RPC rate-limits bursts.** Read many values through Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`, as `chain.ts` does.
- **viem caches `getBlockNumber` for 4 seconds.** Pass `cacheTime: 0` anywhere freshness matters.
- **Forge underestimates gas here.** It said 4.7M for a deploy that used 15M, and Monad bills the gas limit, not gas used.

## Kuru

SPYx is on `MockVenue`, using the PRD's kill switch. Real trading on Kuru's testnet needs their team:

- Kuru has moved to new contracts. The ones in the old `@kuru-labs/kuru-sdk` have no code on testnet. The current list is at https://docs.kuru.io/deployments/testnet.md
- `SpotRouter.deploySpotMarket` reverts with `Unauthorized()`, so we can't create a SPYx/MockUSDC market ourselves.
- Kuru's test tokens are admin-minted, with no public faucet.
- Kuru does have a real `SPYx/USDC` book on testnet. To use it, ask them for test tokens, then write a `KuruVenue` that deposits into `AccountCore` and calls `OrderBook.swap`.

Moving SPYx is one owner call, `ScrollBasket.setVenue(spyx, venue)`, with no redeploy.

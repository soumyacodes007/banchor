# Doomscroll Dividends: Demo PRD (v2)

Nov 4, 2026 · @rick

## What changed in v2

v1 bought once a week: one transaction per user per week. That's a nice joke, but it does almost nothing for Monad activity, and it only gives people one reason to touch xStocks. v2 turns the extension into an **everywhere buy button for stocks**, with three loops that each create transactions:

| Loop | Trigger | Txns per active user | Why people come back |
| --- | --- | --- | --- |
| **Highlight to buy** (new) | Select "Nvidia", "$TSLA" or "Apple" on any page | Several a day | Every news article, tweet or Reddit thread becomes a buy button |
| **Scroll dividends** (v1, now streamed) | Minutes on Instagram, YouTube, Netflix, Amazon | One small buy every 30 minutes of scrolling, not one a week | The roast, plus a portfolio that visibly grows |
| **Copy my basket** (new) | Someone opens your roast card | 1+ per viewer, and a new wallet | The card is now an onboarding funnel, not just a picture |

Plus **one-tap top-up**, so an empty wallet never blocks a buy.

The design rule that makes this work: **Monad is cheap and fast, so we can do many small transactions instead of one big one.** Small, frequent, user-approved buys are the product.

## Demo goal

In 3 minutes, judges watch a real browser turn into a stock terminal: scrolling earns stock, highlighting a company name buys it, and a judge buys from a QR code on their own phone.

The demo must prove five things, in this order:

1. **It tracks real attention.** The extension shows real minutes per site from the presenter's laptop, and a live badge while scrolling.
2. **Anything you read is buyable.** Highlight a company name on a news site and a buy card appears. One tap buys it onchain.
3. **It's many real transactions on Monad testnet** (chain ID 10143), each clickable on MonadVision, and a live counter shows them.
4. **The user stays in control.** The user sets a weekly spending cap once with Touch ID. Small buys under the cap go through with one tap. Nothing goes over the cap without Touch ID. No seed phrase, no gas.
5. **It spreads.** A judge scans the roast card QR, taps "Copy this basket", and their own transaction lands.

**One line to say out loud:** "These are mock xStocks priced from real stock prices. On mainnet, the same contracts buy the real ones."

**Success bar:** at least one judge buys a stock from their own phone during the demo, and the onchain counter goes up while they watch.

## Product

### 1. Highlight to buy (new, the headline feature)

The user drags across text on any web page. If the selection matches a stock, a small card appears next to it:

```
┌───────────────────────────────┐
│ NVDAx  Nvidia   $187.20  ▲1.4% │
│ [ $1 ] [ $5 ] [ $20 ]  [ Buy ] │
│ You own $12.40 · cap left $31  │
└───────────────────────────────┘
```

- **Matching:** a local dictionary of ~60 names, tickers and cashtags (for example "Nvidia", "NVDA" and "$NVDA" all map to NVDAx). Matching runs entirely in the page; the selected text never leaves the laptop. Only the chosen ticker and amount are sent when the user taps Buy.
- **No match:** show nothing. Never interrupt normal copy and paste. The card appears only for selections under 40 characters that match.
- **Buy:** tapping Buy sends one transaction with the session key (see Control). Under the cap there's no Touch ID; the card flips to "Bought $5 of NVDAx · view tx".
- **Off switch:** a popup toggle and a per-site "never on this site" option.
- **Also from the right-click menu:** "Buy $5 of NVDAx", for people who don't want the floating card.

Why this matters for xStocks: today you read about a company in one tab and buy it in a broker app days later, if ever. Here the moment of interest *is* the buy. It gives people a reason to use xStocks every day, not only when they decide to "go investing".

### 2. Scroll dividends (v1, now streamed)

Same tracking as v1 (see Chrome extension below), but buys happen in small chunks instead of weekly:

- Every **30 tracked minutes** on a mapped site, the extension buys that slice (default $0.30 of the matching stock) with the session key.
- The badge shows it: "0:20 scrolled · +$0.33 of Meta", then "Bought ✓" when a chunk lands.
- Users who prefer v1 behaviour pick **"Ask me weekly"** in the popup, and amounts wait for a "Buy my scroll" tap as before.
- **Detox mode** is unchanged: time saved against a 20 hour baseline buys SPYx, settled daily instead of weekly.

### 3. Copy my basket (new)

The roast card (`/roast/[address]`) gets a **"Copy this basket"** button.

- A viewer taps it, signs in with a passkey (new smart account, gas sponsored), tops up and buys the same stocks in the same proportions, with one transaction.
- The card shows "14 people copied this basket" and a referral line: "Copied from @rick's doomscroll".
- **"Gift $5 of Meta"**: send a stock straight to a friend's address or a claim link. Another transaction, another possible new user.

### 4. One-tap top-up (new)

An empty wallet kills every loop above, so top-up lives everywhere a buy can happen: the popup, the highlight card and the dashboard.

| Where | Demo (testnet) | Mainnet |
| --- | --- | --- |
| Button "Top up $50" | Sponsored call to `MockUSDC.faucet()`, lands in seconds | Card or Apple Pay onramp straight to USDC on Monad |
| Low balance | When the balance can't cover the next buy, the card shows "Top up" instead of "Buy" | Same |
| Auto top-up (optional) | Off by default. When on, refills to $X when the balance drops under $5 | Same, capped by the weekly cap |

Top-up itself is a transaction too.

### Control: weekly cap + session key

Many small buys can't each need Touch ID, or nobody will use them. So:

1. On first sign-in, the user sets a **weekly cap** (default $25) and confirms once with Touch ID.
2. That creates a **session key** in the extension, scoped by the smart-account kit's permissions module to:
   - only call `ScrollBasket.buy` / `buyBasket`, `MockUSDC.approve` to ScrollBasket, and `MockUSDC.faucet`
   - at most the cap in USDC per 7 days
   - expires after 30 days
3. Buys under the cap use the session key: one tap, no prompt. Anything over the cap, raising the cap or sending a gift asks for Touch ID.
4. The popup shows "Spent $8.40 of $25 this week" and a **Revoke** button.

The pitch line stays true: nothing buys without the user's say-so. The cap *is* the say-so, and the user can see and revoke it.

## What to deploy

Everything runs on Monad testnet: contracts, one deployer wallet, a gas sponsor and a small backend. One Foundry script deploys all contracts.

### Network

| Setting | Value |
| --- | --- |
| Chain ID | 10143 |
| RPC | https://testnet-rpc.monad.xyz |
| Explorer | https://testnet.monadvision.com |
| Faucet (test MON for gas) | https://faucet.monad.xyz |

### Contracts

| # | Contract | What it does | Notes |
| --- | --- | --- | --- |
| 1 | MockUSDC | Test dollars, 6 decimals, public `faucet()` up to 1,000 per call | The user spends this |
| 2 | MockRouter | Swaps USDC for a mock stock at an owner-set price | Stands in for a real Monad DEX |
| 3 | ScrollBasket | `buy(stock, amount, minOut, source)` for single buys; `buyBasket(stocks, amounts, minOuts, source)` for several; `buyFor(to, ...)` for gifts | Emits `ScrollBuy(user, stock, usdc, out, source, ref)`. `source` is `SCROLL`, `HIGHLIGHT`, `COPY` or `GIFT`, so we can count each loop onchain |
| 4 | StockFactory | Deploys a MockStock per ticker and registers it with the router | Replaces 5 hand-deployed stock contracts, so adding a ticker is one call |
| 5+ | MockStock × ~20 | Mock xStocks, only the router can mint | The four scroll stocks (METAx, GOOGLx, NFLXx, AMZNx), SPYx for Detox, and ~15 popular highlight targets: NVDAx, TSLAx, AAPLx, MSFTx, AMDx, COINx, MSTRx, PLTRx, HOODx and so on |

`ref` on `ScrollBuy` is the address whose roast card was copied (zero otherwise). It gives us an onchain referral graph for free.

The deploy script sets every router price. `prices.ts` updates them to real closing prices the morning of the demo.

### Wallets

| Wallet | Role | Needs |
| --- | --- | --- |
| Deployer | Deploys contracts, owns the router and factory, sets prices | ~1 test MON |
| Gas sponsor | Paymaster for passkey and session-key transactions | More test MON than v1: budget for ~500 sponsored txns on demo day |
| Demo user | Presenter's passkey smart account with an active session key | Mock USDC |
| Backup user | Second account in case the first breaks | Same |

### Hosting

| Piece | Where | Why |
| --- | --- | --- |
| Dashboard (Next.js) | Vercel | Public URL for the QR code, sign-in, copy-basket |
| Backend (Node) | Railway or Render | Stores minutes, indexes `ScrollBuy` events for the counter and roast card. Holds no user keys |
| Extension | Loaded unpacked in Chrome | No Web Store review for a demo |

## What to write

One monorepo, four folders. About 1,800 lines in total (v1 was 1,200).

```
doomscroll-dividends/
  contracts/
    src/MockUSDC.sol
    src/MockStock.sol
    src/StockFactory.sol
    src/MockRouter.sol
    src/ScrollBasket.sol
    script/Deploy.s.sol
    test/ScrollBasket.t.sol
  extension/            Chrome extension (Manifest V3)
    manifest.json
    background.js       tracking, chunked scroll buys, session key signer
    live.js             live badge (Instagram, YouTube)
    highlight.js        selection → ticker match → buy card (all sites)
    tickers.json        names, tickers, cashtags → stock address
    popup.html
    popup.js            cap, spend, top-up, toggles, revoke
  backend/
    server.ts
    indexer.ts          reads ScrollBuy events → counters, roast data
    prices.ts
    addresses.json
  web/
    app/page.tsx                  landing + sign-in + cap setup
    app/dashboard/page.tsx
    app/roast/[id]/page.tsx       roast card + Copy this basket + Gift
    app/live/page.tsx             big onchain counter for the stage
    lib/wallet.ts                 passkey smart account + paymaster
    lib/session.ts                create, hand to extension, revoke session key
    lib/buy.ts                    single buy, basket buy, gift, top-up
```

| File | Done when |
| --- | --- |
| ScrollBasket.sol | Tests pass for mismatched arrays, zero amounts, unpriced stock, `buyFor` to a third party, and correct `source`/`ref` in events |
| StockFactory.sol | `create("NVDAx", price)` deploys a stock the router can mint and nobody else can |
| MockRouter.sol | $0.10 at $600 returns 0.000166 METAx |
| highlight.js | Selecting "Nvidia" on a news article shows the card in under 200 ms; selecting a normal sentence shows nothing |
| background.js | A day of browsing gives sensible minutes, and 30 tracked minutes triggers exactly one chunk buy |
| session.ts | A session-key buy over the cap reverts; revoke stops the next buy |
| popup.js | Shows minutes, spend vs cap, top-up, toggles and revoke |
| indexer.ts | Counter on `/live` updates within 2 seconds of a buy |
| roast/[id]/page.tsx | Opens on a phone from a QR; Copy this basket completes on a fresh phone in under 60 seconds |

## Chrome extension

**Permissions:** tabs, alarms, idle, storage, contextMenus, plus a content script on all sites for highlight-to-buy.

The all-sites content script is the one privacy cost of v2, so be explicit about it in the popup and the README: it only reads the current selection, matches it against `tickers.json` locally, and sends nothing unless the user taps Buy. It can be turned off globally or per site.

### Site to stock map (scroll dividends)

| Site | Stock | Note |
| --- | --- | --- |
| instagram.com, facebook.com | METAx | |
| youtube.com | GOOGLx | Video site |
| netflix.com | NFLXx | Video site |
| amazon.com | AMZNx | |
| x.com | none | Roast line: "not even investable" |

### Counting rules (unchanged from v1)

1. Every 60 seconds an alarm checks the active tab in the focused window.
2. Count the minute only if Chrome says the user was active in the last 60 seconds.
3. On video sites, also count the minute if the tab is playing sound.
4. Store totals as `{ METAx: 840, GOOGLx: 300 }` in `chrome.storage.local`, plus `unbought` per ticker for chunked buys.

### Live mode (for the stage)

- Content script on instagram.com and youtube.com counts seconds while visible and scrolling or playing.
- Corner badge updates every second: "0:20 scrolled · +$0.33 of Meta".
- Live mode raises the rate to $1 per minute and lowers the chunk to 20 seconds, so the badge both ticks up *and* fires a real transaction on stage.

## Backend

Holds no user keys and never buys anything. Every buy is signed by the user's passkey or the user's session key.

| Endpoint | Output |
| --- | --- |
| `POST /api/minutes` | Saved totals |
| `GET /api/basket/:address` | Stocks and amounts to buy now (Ask me weekly mode) |
| `GET /api/portfolio/:address` | Balance of each mock stock + USD value |
| `GET /api/roast/:address` | Roast data: hours, dollars, holdings, copy count, top highlight buys |
| `GET /api/stats` | Total txns, by source, unique wallets, last 20 buys (for `/live`) |
| `GET /api/prices` | Current router prices for the highlight card |

### Buy amounts

- **Scroll (Roast mode):** `dollars = (minutes / 10) * rate`, default $0.10 per 10 minutes, bought in 30-minute chunks.
- **Detox mode:** `saved = baseline - minutes` (baseline 20 h/week), `dollars = (saved / 10) * rate`, all SPYx, settled daily.
- **Highlight:** whatever the user taps, $1 / $5 / $20.
- Skip anything under $0.01. `minOut` is 0 on testnet only.

## Dashboard and roast card

### Landing

- "Meta profits from your attention. Take a cut."
- "Sign in with Touch ID" → passkey smart account → set weekly cap → Top up $50. Three taps to a funded, ready wallet.

### Dashboard

| Element | What it does |
| --- | --- |
| Top up | Faucet on testnet, onramp on mainnet |
| Cap | "Spent $8.40 of $25 this week", edit (Touch ID), revoke |
| Mode | Roast (buy what you scroll) or Detox (buy SPYx with time saved) |
| Activity | Every buy with its source (scroll, highlight, copy, gift) and MonadVision link |
| Portfolio | Mock stock balances and USD value |

### Roast card (`/roast/[address]`)

- "You scrolled 14 hours this week. You now own $8.40 of Meta."
- "Mark Zuckerberg thanks you for your service."
- "You highlighted Nvidia 9 times and bought it 3 times. Jensen thanks you too."
- If x.com time exists: "6 hours on X. That's not even investable. Pure loss."
- Detox version: "You scrolled 6 hours less than usual. That's $3.60 of the S&P 500."
- **Copy this basket** and **Gift $5** buttons, copy count, "Verified on Monad" link.
- Open Graph image so it previews on X and WhatsApp.

### Live counter (`/live`)

Full-screen page for the stage: big number of transactions today, split by source, and a ticker of the latest buys ("0x3a… bought $5 NVDAx via highlight · 2s ago").

## Demo script (3 minutes)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:15 | Title slide, one screen-time stat | "Every hour you scroll, Meta makes money. You get nothing. We fixed that." |
| 0:15 to 0:30 | Extension popup | "This is my real week. Fourteen hours on Instagram. It's been quietly buying me Meta all week: 28 transactions." |
| 0:30 to 0:50 | Scroll Instagram, badge ticks, a chunk buy fires | "Watch the corner. Twenty seconds of scrolling… and that's a real buy on Monad." |
| 0:50 to 1:20 | Open a news article, highlight "Nvidia", card appears, tap $5 | "But it's not just scrolling. Anything I read, I can own. Highlight, tap. No broker, no app switch, no Touch ID, because it's under the cap I set." |
| 1:20 to 1:35 | Click the tx, MonadVision opens | "There it is onchain. Anyone can check." |
| 1:35 to 1:50 | Popup: "Spent $13.70 of $25" and Revoke | "I set the cap once with Touch ID. Over the cap, it asks again. Revoke anytime." |
| 1:50 to 2:20 | Roast card full screen, then QR | "Mark Zuckerberg thanks me for my service." Pause. "Scan it. Tap Copy this basket. You get your own wallet and your own stocks in under a minute." |
| 2:20 to 2:40 | `/live` counter, judges' buys appear | "That's you, buying on Monad, right now." |
| 2:40 to 3:00 | Closing slide | "Mock xStocks, real prices, real Monad transactions. On mainnet the same contracts buy real xStocks, and every page on the internet becomes a buy button." |

### Rules for the presenter

- Real numbers only. If the week is boring, scroll more before the demo, honestly.
- Pre-pick the news article and confirm "Nvidia" is in the first paragraph.
- Keep the dashboard, `/live` and MonadVision open in tabs.
- Have the deploy table and the session-key scope ready for Q&A.

## Build schedule

One developer, 5 days (v1 was 4). Install the extension on day 1.

1. **Day 1:** Extension tracking, live badge, popup. Install on the presenter's laptop.
2. **Day 2:** Contracts (factory, `source`/`ref`, `buyFor`) + tests, deploy, `addresses.json`.
3. **Day 3:** Passkey sign-in, weekly cap + session key, top-up, chunked scroll buys.
4. **Day 4:** Highlight to buy (`highlight.js`, `tickers.json`, context menu), indexer and `/live`.
5. **Day 5:** Roast card with Copy and Gift, Detox, polish, three timed rehearsals.

If time runs short, cut in this order: Gift, auto top-up, context menu, Detox daily settlement. Never cut highlight-to-buy or Copy this basket: they are the new pitch.

### Night before

- [ ] Gas sponsor funded for ~500 txns, one sponsored session-key txn worked
- [ ] Demo and backup users hold mock USDC and have active session keys
- [ ] Router prices updated to that day's closes
- [ ] Extension shows 10+ hours of real time and real chunk buys on MonadVision
- [ ] Highlight card tested on the chosen article and on two other news sites
- [ ] Copy this basket tested end to end on a fresh phone on mobile data
- [ ] `/live` counter updating
- [ ] Screen recording of a perfect run saved locally

## Fallbacks

| If this breaks | Do this |
| --- | --- |
| Public RPC slow or rate-limited | Switch to https://rpc.ankr.com/monad_testnet or https://rpc-testnet.monadinfra.com |
| A transaction hangs | Show this morning's txns on MonadVision and keep going |
| Session key rejected | Buy with Touch ID instead; say "this is the over-cap path" |
| Highlight card doesn't show | Use the right-click "Buy $5 of NVDAx" menu |
| Judges can't sign in on phones | Show `/live` with the presenter's backup account doing a copy buy |
| Instagram asks to log in | Scroll YouTube; it buys GOOGLx the same way |
| Wi-Fi drops | Phone hotspot, then the recording. If you play the recording, say so |

## Metrics to show (and to report after)

All read from `ScrollBuy` events, so they're verifiable onchain:

- Total transactions, and transactions per active wallet per day (target: 5+)
- Split by source: scroll, highlight, copy, gift
- New wallets from Copy this basket (the viral coefficient)
- Distinct xStocks held per wallet (are people using more than the one they scroll?)

## Out of scope for the demo

- Real xStocks and a real DEX (mainnet, once xStocks addresses and liquidity on Monad are confirmed)
- Real fiat onramp (testnet uses the faucet; the button and flow are the same)
- Phone app (iPhone screen-time access is restricted)
- Selling, limit orders, or anything beyond buy
- Live price oracles and `minOut` slippage protection (required on mainnet)
- Chrome Web Store listing
- Fees or business model (obvious later option: a small spread on highlight buys)
- Regional checks for xStocks (required before launch; xStocks aren't offered in the US)

## Sources

- Monad testnet network information
- Stash Stock-Back (the "own what you use" model this builds on)
- xStocks native launch on Monad (CoinGape)

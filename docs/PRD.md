# Doomscroll Dividends: Demo PRD

Nov 4, 2026 · @rick

## Demo goal

In 3 minutes, judges watch one person's real week of scrolling turn into real Monad testnet transactions that buy mock xStocks, then laugh at the roast card.

The demo must prove four things, in this order:

1. **It tracks real attention.** The extension shows actual minutes per site from the presenter's own laptop, plus a live badge while scrolling.
2. **It buys onchain.** One tap sends a real transaction on Monad testnet (chain ID 10143), clickable on MonadVision.
3. **The user stays in control.** Nothing buys on its own. The user taps "Buy my scroll" and confirms once with Touch ID. No seed phrase, no gas.
4. **It's funny and shareable.** The roast card lands the joke, and Detox mode shows the useful side.

**One line to say out loud:** "These are mock xStocks priced from real stock prices. On mainnet, the same vault buys the real ones."

**Success bar:** a judge can scan a QR code, open a transaction on the explorer, and see the stock land in the wallet.

## What to deploy

Everything runs on Monad testnet: eight contracts, one deployer wallet, a gas sponsor and a small backend. Deploy all contracts with one Foundry script.

Nothing buys on its own. The user taps once, confirms with a passkey, and one `buyBasket()` call buys every stock straight into their wallet.

### Network

| Setting | Value |
| --- | --- |
| Chain ID | 10143 |
| RPC | https://testnet-rpc.monad.xyz |
| Explorer | https://testnet.monadvision.com |
| Faucet (test MON for gas) | https://faucet.monad.xyz |

### Contracts (deploy in this order)

| # | Contract | What it does | Notes |
| --- | --- | --- | --- |
| 1 | MockUSDC | Test dollars, 6 decimals, public `faucet()` up to 1,000 per call | The user spends this |
| 2 | MockRouter | Swaps USDC for a mock stock at an owner-set price | Stands in for a real Monad DEX |
| 3 | ScrollBasket | `buyBasket(stocks, amounts, minOuts)` takes the user's USDC once and buys several stocks in one call | Emits a `ScrollBuy` event the roast card reads |
| 4 | METAx (MockStock) | Mock Meta xStock, only the router can mint | Price ~$600 |
| 5 | GOOGLx (MockStock) | Mock Alphabet xStock | Price ~$180 |
| 6 | NFLXx (MockStock) | Mock Netflix xStock | Price ~$700 |
| 7 | AMZNx (MockStock) | Mock Amazon xStock | Price ~$200 |
| 8 | SPYx (MockStock) | Mock S&P 500 xStock, bought in Detox mode | Price ~$600 |

The deploy script also calls `router.setPrice()` for each stock. Update the prices to real closing prices the morning of the demo.

### Wallets

| Wallet | Role | Needs |
| --- | --- | --- |
| Deployer | Deploys contracts, owns the router and sets prices | ~1 test MON |
| Gas sponsor | Pays gas for the user's passkey transactions (the paymaster from your smart-account kit) | Test MON, per the kit's setup |
| Demo user | The presenter's passkey smart account | Mock USDC from the faucet |
| Backup user | A second account in case the first breaks | Same as above |

### Hosting

| Piece | Where | Why |
| --- | --- | --- |
| Dashboard (Next.js) | Vercel | Public URL for the QR code, and where the user taps Buy |
| Backend (Node) | Railway or Render | Stores weekly minutes and roast card data. Holds no keys |
| Extension | Loaded unpacked in Chrome | No Web Store review needed for a demo |

## What to write

One monorepo with four folders: contracts, extension, backend and web. About 1,200 lines of code in total.

```
doomscroll-dividends/
  contracts/            Foundry project
    src/MockUSDC.sol
    src/MockStock.sol
    src/MockRouter.sol
    src/ScrollBasket.sol
    script/Deploy.s.sol
    test/ScrollBasket.t.sol
  extension/            Chrome extension (Manifest V3)
    manifest.json
    background.js
    live.js             Live mode badge (content script)
    popup.html
    popup.js
  backend/              Node
    server.ts
    prices.ts
    addresses.json
  web/                  Next.js dashboard
    app/page.tsx        landing + login
    app/dashboard/page.tsx
    app/roast/[id]/page.tsx
    lib/wallet.ts       passkey smart account + gas sponsor
    lib/buy.ts          approve + buyBasket in one batched call
```

| File | What it does | Done when |
| --- | --- | --- |
| ScrollBasket.sol | `buyBasket(stocks, amounts, minOuts)` pulls the user's USDC once and buys each stock to the user | Tests pass for mismatched arrays, zero amounts, an unpriced stock |
| MockRouter.sol | `swapExactIn()` mints stock at `amountIn * 1e18 / price` | $0.10 at $600 returns 0.000166 METAx |
| MockStock.sol | ERC-20 that only the router can mint | Mint from any other address reverts |
| MockUSDC.sol | 6-decimal ERC-20 with a public `faucet()` | Anyone can mint 1,000 |
| Deploy.s.sol | Deploys all eight, sets prices, prints addresses | One command deploys to testnet |
| ScrollBasket.t.sol | Foundry tests for the basket | `forge test` is green |
| background.js | Counts minutes per site every 60 seconds | A day of browsing shows sensible numbers |
| live.js | Live mode: counts seconds on Instagram and YouTube, shows the badge | The badge moves during a 20-second scroll |
| popup.js | Shows this week's amounts, "Buy my scroll" and "Not now" | Buy opens the dashboard with this week's totals |
| server.ts | Stores weekly totals, serves basket, portfolio and roast data | Endpoints return JSON |
| prices.ts | Sets router prices from real closing prices | Prices match the morning's closes |
| buy.ts | Builds the batched approve + `buyBasket()` call | One Touch ID prompt buys every stock |
| dashboard/page.tsx | Shows amounts, the Buy button, the transaction and the portfolio | Balances update after the buy |
| roast/[id]/page.tsx | Shareable roast card image | Opens on a phone from a QR code |

## Chrome extension

The extension counts minutes per site on the user's laptop and sends only weekly totals per ticker, never page history.

**Permissions:** tabs, alarms, idle, storage. Nothing else.

### Site to stock map

| Site | Stock | Note |
| --- | --- | --- |
| instagram.com, facebook.com | METAx | |
| youtube.com | GOOGLx | Video site |
| netflix.com | NFLXx | Video site |
| amazon.com | AMZNx | |
| x.com | none | Roast line: "not even investable" |

### Counting rules

1. Every 60 seconds an alarm checks the active tab in the focused window.
2. Count the minute only if Chrome says the user is active in the last 60 seconds.
3. On video sites, also count the minute if the tab is playing sound.
4. Store totals as `{ METAx: 840, GOOGLx: 300 }` in `chrome.storage.local`, reset every Monday.

### Live mode (for the stage)

- A content script on instagram.com and youtube.com counts seconds while the tab is visible and the user is scrolling or a video is playing. Add both sites under `content_scripts` in `manifest.json`.
- It shows a small corner badge that updates every second: "0:20 scrolled · +$0.33 of Meta".
- Those seconds are added to the same weekly total, so the next buy includes them.
- Turn it on from the popup. Live mode also raises the rate to $1 per minute, so the badge visibly moves in 20 seconds. At the normal rate, 20 seconds is only $0.003.

### Popup (one screen)

- This week's minutes per site, biggest first
- What each would buy at the user's rate, for example "$8.40 of Meta"
- A "Buy my scroll" button that posts totals to `POST /api/minutes` and opens the dashboard ready to confirm
- A "Not now" button. Nothing is ever bought automatically: unbought amounts keep adding up until the user taps Buy or Reset
- A mode label: Roast or Detox

**Before the demo:** install it on the presenter's laptop at least 3 days early so the numbers are real. Real numbers get the laugh.

## Backend

The backend stores weekly minutes and serves the dashboard and roast card. It holds no keys and never buys anything: every buy is signed by the user.

### Endpoints

| Endpoint | Input | Output |
| --- | --- | --- |
| `POST /api/minutes` | wallet address, `{ ticker: minutes }` | Saved totals |
| `GET /api/basket/:address` | wallet address | Stocks and USDC amounts to buy now |
| `GET /api/portfolio/:address` | wallet address | Balance of each mock stock + USD value |
| `GET /api/roast/:address` | wallet address | Roast card data (hours, dollars, stock amounts) |

### How the buy amount is calculated

- **Roast mode:** `dollars = (minutes / 10) * rate`, default rate $0.10 per 10 minutes, bought in the matching stock.
- **Detox mode:** `saved = baseline - minutes`. If saved is above zero, `dollars = (saved / 10) * rate`, all bought in SPYx (mock S&P 500). For the demo, hardcode the baseline at 20 hours a week.
- Skip any stock under $0.01.

### What happens when the user taps Buy

1. The dashboard fetches the basket from `GET /api/basket/:address`.
2. `buy.ts` builds one batched call: approve USDC to ScrollBasket, then `buyBasket()`.
3. The user confirms once with Touch ID. The gas sponsor pays the gas.
4. One transaction lands on Monad testnet and buys every stock straight into the user's wallet. Show its link: `https://testnet.monadvision.com/tx/<hash>`.
5. `minOut` is 0 on testnet, because the mock router has fixed prices. On mainnet it must come from the live price.

**Price script:** `prices.ts` sets each mock stock's price on the router from real closing prices. Run it the morning of the demo, by hand if needed.

## Dashboard and roast card

The dashboard has three screens, and the roast card is a public page anyone can open from a QR code.

### Screen 1: Landing and login

- One line: "Meta profits from your attention. Take a cut."
- "Sign in with Touch ID" creates a passkey smart account with gas sponsored. No seed phrase, no wallet popup.

### Screen 2: Dashboard

| Element | What it shows or does |
| --- | --- |
| Get test USDC | Calls `faucet()` so the wallet has mock USDC to spend |
| Mode toggle | Roast mode (buy what you scroll) or Detox mode (buy SPYx with time saved) |
| This week | Hours per site and the dollar amount each would buy |
| Big button | "Buy my scroll": one Touch ID prompt buys everything in one transaction |
| Not now | Leaves the amount waiting. Nothing is bought without a tap |
| Transaction | Appears with its MonadVision link once confirmed |
| Scroll portfolio | Mock stock balances and their USD value |

### Screen 3: Roast card (`/roast/[address]`)

- Headline: "You scrolled 14 hours this week. You now own $8.40 of Meta."
- Line two: "Mark Zuckerberg thanks you for your service."
- If x.com time exists: "6 hours on X. That's not even investable. Pure loss."
- Detox version: "You scrolled 6 hours less than usual. That's $3.60 of the S&P 500."
- A small "Verified on Monad" link to one of the transactions
- Rendered as an image too (Open Graph), so it previews when shared on X or WhatsApp

Keep the design bold and simple: big numbers, company logos, one accent colour.

## Demo script

The whole demo runs 3 minutes: 30 seconds of hook, 2 minutes of live product, 30 seconds of close. Rehearse it with a timer at least five times.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:15 | Title slide with one stat about daily screen time | "Every hour you scroll, Meta makes money. You get nothing. We fixed that." |
| 0:15 to 0:30 | Extension popup on the presenter's laptop | "This is my real week. Fourteen hours on Instagram. Five on YouTube." |
| 0:30 to 0:55 | Open Instagram on the demo account and scroll for 20 seconds. The corner badge ticks up live | "Watch the corner. Every second I scroll, I'm earning a slice of Meta." |
| 0:55 to 1:10 | Dashboard, logged in with Touch ID, showing "$8.40 of Meta ready to buy" | "No wallet app, no seed phrase. And nothing buys on its own. I decide when." |
| 1:10 to 1:35 | Click "Buy my scroll", Touch ID once, one transaction confirms | "One tap, one Touch ID, one transaction on Monad testnet. That includes the 20 seconds you just watched." |
| 1:35 to 1:50 | Click the transaction, MonadVision opens | "Here it is onchain. Meta, Google and Netflix landed in my wallet in one go. Anyone can check it." |
| 1:50 to 2:05 | Scroll portfolio updates | "I now own eight dollars and forty cents of Meta. Bought with my own attention." |
| 2:05 to 2:25 | Roast card full screen, then the QR code | "Mark Zuckerberg thanks me for my service." Pause for the laugh. "Scan it, it's live." |
| 2:25 to 2:45 | Flip to Detox mode, card changes | "But the real version is Detox mode: scroll less than usual, and the time you save buys the S&P 500." |
| 2:45 to 3:00 | Closing slide | "These are mock xStocks priced from real prices. On mainnet, the same basket buys real xStocks on Monad." |

### Rules for the presenter

- Show real numbers only. If your week is boring, scroll more before the demo, honestly.
- Keep the dashboard and MonadVision open in two tabs so nothing loads from scratch.
- Don't explain the contracts unless asked. Have the deploy table ready for Q&A.

## Build schedule, checklist and fallbacks

One developer can finish in 4 days. Install the extension on day 1 so it collects a real week by demo day.

### Build order

1. **Day 1:** Extension (tracking, Live mode badge, popup). Install it on the presenter's laptop the same day.
2. **Day 2:** Contracts + Foundry tests, deploy to Monad testnet, save addresses to `addresses.json`.
3. **Day 3:** Backend, then the dashboard with passkey login, gas sponsorship and the batched Buy.
4. **Day 4:** Roast card, Detox mode, polish, and three full rehearsals.

### Night before the demo

- [ ] Gas sponsor is funded and one sponsored test transaction worked
- [ ] Demo user and backup user both hold mock USDC
- [ ] Router prices updated to that day's closing prices
- [ ] Extension shows at least 10 hours of real tracked time
- [ ] A clean demo Instagram account is logged in, and its feed has nothing you wouldn't show judges
- [ ] Live mode badge tested on Instagram and YouTube
- [ ] One full test run of "Buy my scroll" succeeded, and its transaction shows on MonadVision
- [ ] Roast card QR code opens on a phone on mobile data, not venue Wi-Fi
- [ ] Screen recording of a perfect run saved locally

### Fallbacks

| If this breaks | Do this |
| --- | --- |
| Public RPC is slow or rate-limited | Switch the backend to https://rpc.ankr.com/monad_testnet or https://rpc-testnet.monadinfra.com |
| A transaction hangs | Show the txs from the morning's test run on MonadVision, then keep going |
| Passkey login fails on stage | Log in as the backup user, already signed in on a second tab |
| Instagram won't load or asks to log in again | Scroll YouTube instead. The badge works the same and buys GOOGLx |
| Venue Wi-Fi drops | Hotspot from a phone, then play the screen recording if that fails too |
| Extension numbers reset | Use the screenshot of the popup taken the night before |

If you ever play the recording, say so. Judges forgive a backup. They don't forgive a fake.

## Out of scope for the demo

Skip anything the judges can't see in 3 minutes.

- Real xStocks and a real DEX (mainnet only, once xStocks addresses and liquidity on Monad are confirmed)
- A phone app (iPhone screen time access is restricted, so the demo uses Chrome only)
- Auto-buy (an optional later setting; the demo is tap-to-buy only)
- Live price oracles and `minOut` slippage protection (needed on mainnet, not with fixed mock prices)
- Chrome Web Store listing
- Fees, subscriptions or any business model
- Regional checks for xStocks access (needed before a real launch, since xStocks aren't offered in the US)

## Sources

- Monad testnet network information
- Stash Stock-Back (the "own what you use" model this builds on)
- xStocks native launch on Monad (CoinGape)

<div align="center">

<img src="web/app/icon.png" width="96" alt="Banchor" />

# Banchor

### Your attention span, tokenized.

**Banchor turns doomscrolling into a stock portfolio on Monad.**
Scroll Instagram, you own Meta. Binge YouTube, you own Google. Highlight "Nvidia" in an article and you own Nvidia.
Then an AI roasts your portfolio, and your friends copy it.

`Monad Testnet · Chain 10143` · `Passkey wallet, no seed phrase, no gas` · `20 tokenized stocks`

</div>

---

## The problem

Big Tech earns about **$200 a year from your attention**. You earn nothing from it, except screen-time guilt.

Meanwhile, investing still happens in a separate app you open twice a year. You read "Nvidia beats earnings" in one tab and **never actually buy the stock.**

## The fix

Banchor is a Chrome extension and web app that makes **wherever your attention goes the buy button.**

| Loop | You do this | Banchor does this |
| --- | --- | --- |
| 📱 **Scroll dividends** | Lose 30 minutes on Instagram | Buys you $0.30 of **METAx**. *"Mark Zuckerberg thanks you for your service."* |
| 🖱️ **Highlight to buy** | Select `Nvidia`, `$TSLA` or `Apple` on any page | A buy card appears. One tap and it's onchain. *"Jensen thanks you too."* |
| 🔥 **Roast card** | Open your weekly card | *"You scrolled 14 hours this week. You now own $4.20 of Meta."* |
| 🧬 **Copy my basket** | A friend scans your roast QR | They sign up with a passkey and copy your exact portfolio in **one transaction** |
| 🧘 **Detox mode** | Scroll *less* than your baseline | The minutes you saved buy **SPYx**. Self-control finally pays. |

> *"38 hours on X. That's not even investable. Pure loss."* (actual Banchor roast)

---

## Why Monad

Banchor's core design is **many tiny buys instead of one big one**: $0.30 per scroll chunk, $1 per highlight, every day, for every user.

On most chains that's impossible: gas costs more than the trade, and confirmations take longer than an attention span. On Monad:

- ⚡ **Sub-second finality.** The buy lands before you finish reading the headline.
- 💸 **Near-zero fees.** Micro-buys of $0.30 actually make sense.
- 📈 **Real activity.** Each active user creates several transactions a day, and every one can be checked on MonadVision.

**Banchor is a transaction generator disguised as a joke.**

---

## Demo, in 3 minutes

1. **Live tracking.** The extension badge reads `0:20 scrolled · +$0.33 of Meta` while we scroll Instagram.
2. **Highlight to buy.** We select "Nvidia" in a news article, tap **$5**, and the card flips to `Bought ✓ · view tx`.
3. **Live counter.** The dashboard's onchain transaction counter goes up in real time.
4. **The roast.** We open the roast card, and the room laughs at us.
5. **Your turn.** A judge scans the QR, signs in with Face ID, taps **Copy this basket**, and their own transaction lands on Monad.

---

## Architecture

```
┌──────────────────────┐   minutes    ┌──────────────────────┐
│  Chrome Extension    │ ───────────► │  Backend (Railway)   │
│  · attention tracker │              │  · basket planner    │
│  · highlight-to-buy  │ ◄─────────── │  · roast engine      │
│  · live badge        │  buy args    │  · event indexer     │
└──────────┬───────────┘              └──────────▲───────────┘
           │ session-key buys                    │ ScrollBuy events
           ▼                                     │ (polled every ~500ms)
┌───────────────────────────────────────────────┴──────────────┐
│                    Monad Testnet (10143)                     │
│  ScrollBasket ─► MockRouter ─► MockVenue ─► 20 xStock tokens │
│  MockUSDC · StockFactory                                     │
└──────────────────────────────▲───────────────────────────────┘
                               │ passkey smart account
                    ┌──────────┴───────────┐
                    │  Next.js Web App     │
                    │  · dashboard         │
                    │  · /roast/[address]  │
                    │  · one-tap top-up    │
                    └──────────────────────┘
```

| Layer | Stack |
| --- | --- |
| `contracts/` | Solidity + Foundry. `ScrollBasket` routes single buys, baskets, copies and gifts, and tags each with its source (`SCROLL`, `HIGHLIGHT`, `COPY`, `GIFT`) |
| `backend/` | Node 24 + SQLite. Rebuilds all buys from chain events and holds **no keys**. Prices are synced from real market closes |
| `extension/` | Manifest V3. Matching happens **locally in the page**, so selected text never leaves your laptop |
| `web/` | Next.js dashboard with a Mera **passkey wallet**: Touch ID, no seed phrase, sponsored gas |

### Privacy and control

- Highlighted text is matched on-device against a dictionary of about 60 names and tickers. Only the ticker and amount you choose are sent.
- You set a **weekly spending cap** once with Touch ID. Small buys under the cap take one tap. Anything over the cap needs Touch ID again.
- Every number in the app can be recomputed from the chain, because the backend never self-reports buys.

---

## Deployed contracts (Monad Testnet)

| Contract | Address |
| --- | --- |
| ScrollBasket | [`0x1d775CF873c2783D1e0FE6a20e0966548A827BA7`](https://testnet.monadvision.com/address/0x1d775CF873c2783D1e0FE6a20e0966548A827BA7) |
| MockRouter | `0xb361cc73B5813338E661e1c373433F04aFc82C80` |
| MockVenue | `0x400a452B564eA24332e8E1a10065355D7837Ea57` |
| StockFactory | `0x70Ae475Fbf221e90ee51BbE6427F97f27EAf6080` |
| MockUSDC | `0xB5CC9995a1ddbdED596804af5B59B452cEc70D40` |

There are 20 stocks: AAPL, AMD, AMZN, BABA, COIN, DIS, GOOGL, HOOD, INTC, META, MSFT, MSTR, NFLX, NVDA, ORCL, PLTR, SHOP, SPY, TSLA and UBER. All addresses are in [`backend/addresses.json`](backend/addresses.json).

**Live API:** https://backend-production-1dd0.up.railway.app

> These are mock xStocks priced from real stock prices. On mainnet, the same contracts would buy the real ones.

---

## Run it locally

```bash
# 1. Backend
cd backend && npm install && npm start            # :4000

# 2. Web app
cd web && npm install && npm run dev              # :3000

# 3. Extension
# chrome://extensions → Developer mode → Load unpacked → select ./extension

# 4. Contracts (optional, already deployed)
cd contracts && forge test
```

Full API and contract reference: [`backend/README.md`](backend/README.md). Product spec: [`docs/PRD.md`](docs/PRD.md).

---

## What's next

- 🏦 **Mainnet xStocks.** Swap MockVenue for the real tokenized-equity venue. No contract changes are needed.
- 🏆 **Leaderboards.** "Most cooked portfolio of the week."
- 🎁 **Gift stocks.** `buyFor()` is already deployed. Send a friend $5 of NFLX with the message "you watched it, you own it".
- 🔐 **Signed minute reports**, so attention data can't be spoofed.

---

<div align="center">

### Banchor: Proof of Doomscroll.

Built at **Monad Blitz, Devcon Mumbai** 🇮🇳

</div>

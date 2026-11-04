# Doomscroll Dividends: Chrome extension

Manifest V3. It tracks attention, matches highlights to stocks and builds buy intents. **It holds no keys and never signs anything.** Every buy is signed in the dashboard by the user's passkey or session key, then the extension checks the transaction on Monad testnet (chain 10143) before marking it bought.

## Install

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Before building, fill in `config.json` with the deployment values. Users never see them:
   - `dashboardUrl` (Vercel)
   - `backendUrl` (Railway/Render)
   - `rpcUrl`: `https://testnet-rpc.monad.xyz` by default. The PRD's fallbacks `rpc.ankr.com/monad_testnet` and `rpc-testnet.monadinfra.com` are also allowed.
   - `addresses`: paste `backend/addresses.json` exactly as the deploy script writes it.

The wallet address is set automatically when the user signs in on the dashboard (see `DD_SET_WALLET` below); the popup shows a **Continue with Mera** button that opens `DASHBOARD/dashboard?signin=mera`.

### Sign-in with Mera (dashboard side)

[Mera](https://docs.monad.xyz/guides/mera) is Monad's free passkey wallet library (`@category-labs/mera`). It derives a normal EVM account from a passkey via the WebAuthn PRF extension. A Mera passkey is bound to the `rpId` (hostname) that created it, so it must run on the dashboard, never in the extension: an extension passkey would belong to `chrome-extension://…` and give a different account.

On `?signin=mera` the dashboard should:

1. `npm install @category-labs/mera viem @scure/bip32 @scure/bip39`
2. New user: `createPasskeyWithPrfOutput({ rp: { id: location.hostname, name: "Banchor" }, user })`. Returning user: `getPasskeyPrfOutput({ rpId: location.hostname, credential })`.
3. Derive the key from `prfOutput` (BIP-39 → `m/44'/60'/0'/0/0`), wrap it with `createSecp256k1SigningSession` + `toViemAccount`, and read `account.address`.
4. Send it to the extension: `chrome.runtime.sendMessage(EXTENSION_ID, { type: "DD_SET_WALLET", address })`.

Notes: the dashboard domain must never change, or users lose access to the account (only the exported 24-word phrase recovers it). On desktop Chrome only passkeys saved in Google Password Manager return PRF. Set `gas` explicitly on Monad transactions.

For local testing you can override `config.json` without rebuilding: **Option/Alt-click the footer** in the popup to reveal the hidden developer settings. Blank fields there fall back to `config.json`.

## Files

| File | Does |
| --- | --- |
| `manifest.json` | Permissions: tabs, alarms, idle, storage, contextMenus, plus the content scripts. |
| `background.js` | Counts a minute every 60s (active tab, focused window, user active or video tab audible). Adds Live seconds, computes the basket in Roast and Detox modes, creates buy intents, and verifies receipts over RPC. |
| `live.js` | Instagram and YouTube. While Live mode is on, it counts visible seconds of scrolling or video playback and shows the corner badge. |
| `highlight.js` | Any site. If a selection under 40 characters matches `tickers.json`, it shows the buy card ($1 / $5 / $20). Also used for the right-click menu. Reads the page text only when the user taps Analyze. |
| `tickers.json` | Names, tickers and cashtags for each stock, plus the site → stock map. A stock is only offered if its key exists in `addresses.json`. |
| `popup.*` | Analyze this page, this week's sites, the basket, Buy / Not now, top-up, USDC balance read from chain, toggles, Settings. |

**Analyze this page** sends the open page's URL, title and text to the backend, only when tapped, and shows what to buy with one button to buy it all. For the demo, use the [Nasdaq article](https://www.nasdaq.com/articles/nvidia-and-palantir-cool-2026-concerning). It works there even with no OpenRouter key, and shows "Saved analysis". A tab opened before the extension was loaded needs a reload first.

## What the extension expects from the rest of the repo

Nothing here is a stub. Each item is an interface the backend, contracts or web owner provides.

### `addresses.json` (contracts)

Keys used: `MockUSDC`, `ScrollBasket`, and one key per stock ticker exactly as in `tickers.json` (`METAx`, `GOOGLx`, `NFLXx`, `AMZNx`, `SPYx`, `NVDAx`, ...). Extra keys are ignored.

The extension reads USDC with `balanceOf(address)` (`0x70a08231`) over RPC and checks that a confirmed buy's receipt contains a log from `ScrollBasket`.

### Backend (PRD endpoints)

| Call | Request / expected response |
| --- | --- |
| `POST /api/minutes` | Sends `{ "address": "0x…", "minutes": { "METAx": 840, "GOOGLx": 300 } }`. Only weekly totals per ticker, never page history. |
| `GET /api/prices` | Expects `{ "NVDAx": 187.2, "METAx": 600.1, ... }` (USD per share). |
| `GET /api/portfolio/:address` | Expects `{ "METAx": { "usd": 8.4, ... }, ... }`. Only `usd` is read. |

If the backend is down, the extension keeps working. The card simply leaves out the price and "You own" lines.

### Dashboard (`web/`)

A buy opens `DASHBOARD/dashboard?intent=<base64 JSON>`:

```json
{
  "id": "uuid",
  "chainId": 10143,
  "source": "SCROLL | HIGHLIGHT",
  "items": [{ "ticker": "NVDAx", "stock": "0x…", "usdc": "5000000", "usd": 5 }],
  "createdAt": 1762250000000
}
```

`usdc` is in 6-decimal base units, ready to pass straight into `buy` / `buyBasket`. `source` maps to the `ScrollBuy` event's `source` field.

Top-up opens `DASHBOARD/dashboard?topup=50`, where the dashboard runs a sponsored `MockUSDC.faucet()`.

The dashboard reports back using `chrome.runtime.sendMessage(EXTENSION_ID, msg)`. This is allowed from `*.vercel.app` and `localhost`, and only from the configured dashboard origin once one is set.

| Message | When |
| --- | --- |
| `{ type: "DD_PING" }` | Detect the extension. |
| `{ type: "DD_SET_WALLET", address }` | After passkey sign-in. |
| `{ type: "DD_GET_INTENT", intentId }` | Optional: re-read an intent. |
| `{ type: "DD_BOUGHT", intentId, txHash }` | After the tx is sent. The extension waits for the receipt on Monad testnet and only marks the buy bought if `status = 1` and a ScrollBasket log is present. |
| `{ type: "DD_CANCELLED", intentId }` | User closed or rejected the buy; the amounts return to unbought. |

## Counting and amounts (from the PRD)

- **Roast:** $0.10 per 10 minutes in the matching stock. In streaming mode, Buy lights up (badge `$`) once a ticker has ≥ $0.30 unbought, roughly 30 minutes of scrolling.
- **Live mode:** $1 per minute, with a chunk every 20 seconds. On Instagram and YouTube, `live.js` replaces the per-minute alarm so nothing is counted twice.
- **Detox:** a 20 h/week baseline, prorated across the week. Time saved buys SPYx.
- Items under $0.01 are skipped. Totals reset on Monday; unbought dollars carry over until the user taps Buy or Reset.
- **Nothing buys on its own.** Every buy starts from a user tap: the popup, the highlight card or the context menu.

## Not done yet

Silent session-key buys, where an under-cap buy needs no confirmation, depend on which smart-account kit `web/lib/session.ts` uses. Today every buy goes through the dashboard tab. When the kit is chosen, the session-key signer can plug in at `createIntent()` in `background.js` without changing the intent format.

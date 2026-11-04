# Banchor web (Next.js)

Landing, dashboard, roast card and live stage page. Wallets are [Mera](https://docs.monad.xyz/guides/mera) passkey accounts (Monad), derived in the browser; nothing secret is stored.

```bash
cp .env.example .env.local   # fill in EXTENSION_ID, BACKEND_URL, ADDRESSES
npm install
npm run dev                  # http://localhost:3000
```

| Route | What it does |
| --- | --- |
| `/` | Landing + "Create wallet with Mera" |
| `/dashboard` | Wallet, USDC/MON, portfolio, activity, top up. Handles the extension's `?signin=mera`, `?intent=…` and `?topup=50` links |
| `/roast/[address]` | Roast card + "Copy this basket" ($5, same proportions, one tx, source `COPY`) |
| `/live` | Full-screen counter for the stage, polls `GET /api/stats` |

- `lib/wallet.ts`: Mera create / sign-in; `withSigner()` asks for the passkey once per action and wipes the key afterwards.
- `lib/chain.ts`: faucet top-up, approve + `ScrollBasket.buy` / `buyBasket`. ABIs live in `lib/abi.ts`. Adjust if the deployed contracts differ.
- `lib/extension.ts`: `DD_PING`, `DD_SET_WALLET`, `DD_BOUGHT`, `DD_CANCELLED` to the extension.

Notes
- The passkey is bound to the site's hostname. Deploy to the final domain before real users sign up; a new domain means new accounts.
- Mera accounts are plain EOAs: they need a little test MON for gas (faucet.monad.xyz). Paymaster sponsorship and session-key caps from the PRD need a smart account on top and aren't included.
- On desktop Chrome, only passkeys in Google Password Manager support the PRF extension Mera needs.

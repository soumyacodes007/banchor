import { monadTestnet } from "viem/chains";

export const chain = monadTestnet; // chain id 10143
export const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || "";
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "https://backend-production-1dd0.up.railway.app").replace(/\/$/, "");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadvision.com";

import deployed from "./addresses.json"; // copy of backend/addresses.json (Monad testnet deploy)

type Addr = `0x${string}`;
let override: Record<string, unknown> = {};
try { override = JSON.parse(process.env.NEXT_PUBLIC_ADDRESSES || "{}"); } catch { /* ignore */ }
const merged = { ...deployed, ...override } as Record<string, unknown>;
// Flat map: MockUSDC, ScrollBasket and one entry per stock ticker.
export const ADDRESSES: Record<string, Addr> = Object.fromEntries(
  Object.entries(merged).filter(([, v]) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v as string)),
) as Record<string, Addr>;
export const STOCK_TICKERS = Object.keys(ADDRESSES).filter((k) => /^[A-Z]+x$/.test(k));

export const STOCKS: Record<string, string> = {
  METAx: "Meta", GOOGLx: "Alphabet", NFLXx: "Netflix", AMZNx: "Amazon",
  SPYx: "S&P 500", NVDAx: "Nvidia", AAPLx: "Apple", TSLAx: "Tesla", MSFTx: "Microsoft",
};

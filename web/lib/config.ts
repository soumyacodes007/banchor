import { monadTestnet } from "viem/chains";

export const chain = monadTestnet; // chain id 10143
export const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || "";
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadvision.com";

let parsed: Record<string, `0x${string}`> = {};
try { parsed = JSON.parse(process.env.NEXT_PUBLIC_ADDRESSES || "{}"); } catch { /* keep empty */ }
export const ADDRESSES = parsed;

export const STOCKS: Record<string, string> = {
  METAx: "Meta", GOOGLx: "Alphabet", NFLXx: "Netflix", AMZNx: "Amazon",
  SPYx: "S&P 500", NVDAx: "Nvidia", AAPLx: "Apple", TSLAx: "Tesla", MSFTx: "Microsoft",
};

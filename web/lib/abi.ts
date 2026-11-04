// Minimal ABIs for the PRD contracts. Adjust here if the deployed signatures differ.
import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// MockUSDC: public faucet, mints FAUCET_AMOUNT (1,000 USDC, 6 decimals) per call.
export const mockUsdcAbi = parseAbi(["function faucet()", "function FAUCET_AMOUNT() view returns (uint256)"]);

// ScrollBasket (contracts/src/ScrollBasket.sol): source is SCROLL=0, HIGHLIGHT=1, COPY=2, GIFT=3.
// buyBasket requires ref != 0 exactly when source is COPY (whose roast card was copied).
export const scrollBasketAbi = parseAbi([
  "function buy(address stock, uint256 amount, uint256 minOut, uint8 source) returns (uint256)",
  "function buyBasket(address[] stocks, uint256[] amounts, uint256[] minOuts, uint8 source, address ref) returns (uint256[])",
]);

// MockSellDesk (contracts/src/MockSellDesk.sol): buys a stock back at the router's price.
export const sellDeskAbi = parseAbi(["function sell(address stock, uint256 amount, uint256 minUsdc) returns (uint256)"]);
export const routerAbi = parseAbi(["function prices(address stock) view returns (uint256)"]);

export const SOURCE_ID = { SCROLL: 0, HIGHLIGHT: 1, COPY: 2, GIFT: 3 } as const;
export type Source = keyof typeof SOURCE_ID;

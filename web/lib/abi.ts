// Minimal ABIs for the PRD contracts. Adjust here if the deployed signatures differ.
import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// MockUSDC: public faucet, up to 1,000 USDC (6 decimals) per call.
export const mockUsdcAbi = parseAbi(["function faucet(uint256 amount)"]);

// ScrollBasket: source is SCROLL=0, HIGHLIGHT=1, COPY=2, GIFT=3.
export const scrollBasketAbi = parseAbi([
  "function buy(address stock, uint256 amount, uint256 minOut, uint8 source) returns (uint256)",
  "function buyBasket(address[] stocks, uint256[] amounts, uint256[] minOuts, uint8 source)",
]);

export const SOURCE_ID = { SCROLL: 0, HIGHLIGHT: 1, COPY: 2, GIFT: 3 } as const;
export type Source = keyof typeof SOURCE_ID;

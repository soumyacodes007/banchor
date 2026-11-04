// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockRouter} from "./MockRouter.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice Buys mock stocks back at the router's price. A separate contract, so
/// selling could be added without redeploying the stocks people already hold.
/// @dev Stocks can't be burned, so this keeps what it buys. It pays from MockUSDC's
/// public faucet, because the mock dollars it hands out have no value to run out of.
contract MockSellDesk {
    using SafeERC20 for IERC20;

    MockUSDC public immutable usdc;
    MockRouter public immutable router;

    event ScrollSell(address indexed user, address indexed stock, uint256 amount, uint256 usdcOut);

    error UnpricedStock(address stock);
    error ZeroAmount();
    error InsufficientOutput(uint256 usdcOut, uint256 minUsdc);

    constructor(MockRouter _router) {
        router = _router;
        usdc = MockUSDC(address(_router.usdc()));
    }

    /// @param amount Stock to sell, in 18 decimals. Approve it to this contract first.
    /// @param minUsdc Least to accept. Zero on testnet, where prices are fixed.
    function sell(address stock, uint256 amount, uint256 minUsdc) external returns (uint256 usdcOut) {
        uint256 price = router.prices(stock);
        if (price == 0) revert UnpricedStock(stock);
        if (amount == 0) revert ZeroAmount();

        usdcOut = amount * price / 1e18;
        if (usdcOut == 0) revert ZeroAmount();
        if (usdcOut < minUsdc) revert InsufficientOutput(usdcOut, minUsdc);

        IERC20(stock).safeTransferFrom(msg.sender, address(this), amount);
        while (usdc.balanceOf(address(this)) < usdcOut) usdc.faucet();
        IERC20(address(usdc)).safeTransfer(msg.sender, usdcOut);
        emit ScrollSell(msg.sender, stock, amount, usdcOut);
    }
}

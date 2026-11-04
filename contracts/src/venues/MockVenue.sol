// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockRouter} from "../MockRouter.sol";
import {IStockVenue} from "./IStockVenue.sol";

/// @notice The fixed-price venue: `MockRouter` behind `IStockVenue`.
contract MockVenue is IStockVenue {
    using SafeERC20 for IERC20;

    MockRouter public immutable router;
    IERC20 public immutable usdc;

    constructor(MockRouter _router) {
        router = _router;
        usdc = _router.usdc();
        usdc.forceApprove(address(_router), type(uint256).max);
    }

    function buy(address stock, uint256 usdcIn, uint256 minOut, address to) external returns (uint256) {
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        return router.swapExactIn(stock, usdcIn, minOut, to);
    }
}

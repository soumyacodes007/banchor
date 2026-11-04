// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Where a stock is bought. Moving a stock to a real market is one
/// `setVenue` call on the basket, with no change to the contracts around it.
interface IStockVenue {
    /// @dev Pulls `usdcIn` from the caller and sends the stock to `to`.
    function buy(address stock, uint256 usdcIn, uint256 minOut, address to) external returns (uint256 out);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockStock} from "./MockStock.sol";

/// @notice Stands in for a real Monad DEX: sells mock stocks at owner-set prices.
contract MockRouter is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    /// @notice May list new stocks, alongside the owner.
    address public factory;

    /// @notice USDC (6 decimals) per whole stock. Zero means not for sale.
    mapping(address stock => uint256 price) public prices;

    event PriceSet(address indexed stock, uint256 price);
    event Swapped(address indexed stock, address indexed to, uint256 amountIn, uint256 amountOut);

    error NotAllowed(address caller);
    error UnpricedStock(address stock);
    error ZeroAmount();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    constructor(IERC20 _usdc) Ownable(msg.sender) {
        usdc = _usdc;
    }

    function setFactory(address _factory) external onlyOwner {
        factory = _factory;
    }

    function setPrice(address stock, uint256 price) external {
        if (msg.sender != owner() && msg.sender != factory) revert NotAllowed(msg.sender);
        prices[stock] = price;
        emit PriceSet(stock, price);
    }

    function swapExactIn(address stock, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        uint256 price = prices[stock];
        if (price == 0) revert UnpricedStock(stock);
        if (amountIn == 0) revert ZeroAmount();

        amountOut = amountIn * 1e18 / price;
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        usdc.safeTransferFrom(msg.sender, address(this), amountIn);
        MockStock(stock).mint(to, amountOut);
        emit Swapped(stock, to, amountIn, amountOut);
    }
}

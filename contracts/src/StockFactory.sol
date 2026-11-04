// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockRouter} from "./MockRouter.sol";
import {MockStock} from "./MockStock.sol";

/// @notice Lists a mock stock in one call, so adding a ticker needs no new deploy.
contract StockFactory is Ownable {
    MockRouter public immutable router;

    mapping(string symbol => address stock) public stockOf;
    address[] public stocks;

    event StockCreated(string symbol, address indexed stock, uint256 price);

    error AlreadyListed(string symbol);

    constructor(MockRouter _router) Ownable(msg.sender) {
        router = _router;
    }

    function create(string calldata symbol, uint256 price) external onlyOwner returns (address stock) {
        if (stockOf[symbol] != address(0)) revert AlreadyListed(symbol);

        stock = address(new MockStock(string.concat("Mock ", symbol), symbol, address(router)));
        stockOf[symbol] = stock;
        stocks.push(stock);
        router.setPrice(stock, price);
        emit StockCreated(symbol, stock, price);
    }

    function stockCount() external view returns (uint256) {
        return stocks.length;
    }
}

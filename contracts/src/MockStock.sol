// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A mock xStock. Only the router can create it, so a balance always
/// means someone paid for it.
contract MockStock is ERC20 {
    address public immutable router;

    error OnlyRouter(address caller);

    constructor(string memory name, string memory symbol, address _router) ERC20(name, symbol) {
        router = _router;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != router) revert OnlyRouter(msg.sender);
        _mint(to, amount);
    }
}

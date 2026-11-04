// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockRouter} from "../src/MockRouter.sol";
import {MockSellDesk} from "../src/MockSellDesk.sol";

/// @notice Adds selling to an existing deployment, which keeps every holding.
/// Takes the router from ROUTER_ADDRESS and prints the desk's address.
contract DeploySellDesk is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        MockSellDesk desk = new MockSellDesk(MockRouter(vm.envAddress("ROUTER_ADDRESS")));
        vm.stopBroadcast();
        console.log("MockSellDesk", address(desk));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockRouter} from "../src/MockRouter.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ScrollBasket} from "../src/ScrollBasket.sol";
import {StockFactory} from "../src/StockFactory.sol";
import {MockVenue} from "../src/venues/MockVenue.sol";

/// @notice Deploys everything, lists every stock at its Nov 3, 2026 close, and
/// writes the addresses for the backend. Update prices on demo morning with
/// backend/prices.ts.
contract Deploy is Script {
    struct Listing {
        string symbol;
        uint256 price;
    }

    function listings() internal pure returns (Listing[20] memory) {
        return [
            // Scroll stocks, then SPYx for Detox.
            Listing("METAx", 621.03e6),
            Listing("GOOGLx", 280.03e6),
            Listing("NFLXx", 63.42e6),
            Listing("AMZNx", 250.69e6),
            Listing("SPYx", 754.35e6),
            // Highlight targets.
            Listing("NVDAx", 206.69e6),
            Listing("TSLAx", 398.5e6),
            Listing("AAPLx", 331.9e6),
            Listing("MSFTx", 520.99e6),
            Listing("AMDx", 483.9e6),
            Listing("COINx", 145.45e6),
            Listing("MSTRx", 135.63e6),
            Listing("PLTRx", 175.4e6),
            Listing("HOODx", 85.68e6),
            Listing("INTCx", 60.55e6),
            Listing("ORCLx", 126.19e6),
            Listing("UBERx", 66.6e6),
            Listing("DISx", 114.18e6),
            Listing("SHOPx", 142.57e6),
            Listing("BABAx", 100.36e6)
        ];
    }

    function run() external {
        Listing[20] memory stocks = listings();
        uint256 deployBlock = block.number;

        // Foundry loads contracts/.env, so the key never goes on the command line.
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));

        MockUSDC usdc = new MockUSDC();
        MockRouter router = new MockRouter(usdc);
        MockVenue venue = new MockVenue(router);
        ScrollBasket basket = new ScrollBasket(usdc, venue);
        StockFactory factory = new StockFactory(router);
        router.setFactory(address(factory));

        string memory root = "root";
        string memory stocksKey = "stocks";
        string memory stocksJson;
        for (uint256 i; i < stocks.length; i++) {
            address stock = factory.create(stocks[i].symbol, stocks[i].price);
            stocksJson = vm.serializeAddress(stocksKey, stocks[i].symbol, stock);
            // The extension reads tickers from the top level, by these exact keys.
            vm.serializeAddress(root, stocks[i].symbol, stock);
            console.log(stocks[i].symbol, stock);
        }

        vm.stopBroadcast();

        console.log("MockUSDC", address(usdc));
        console.log("MockRouter", address(router));
        console.log("MockVenue", address(venue));
        console.log("ScrollBasket", address(basket));
        console.log("StockFactory", address(factory));

        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployBlock", deployBlock);
        vm.serializeAddress(root, "MockUSDC", address(usdc));
        vm.serializeAddress(root, "ScrollBasket", address(basket));
        vm.serializeAddress(root, "usdc", address(usdc));
        vm.serializeAddress(root, "router", address(router));
        vm.serializeAddress(root, "venue", address(venue));
        vm.serializeAddress(root, "basket", address(basket));
        vm.serializeAddress(root, "factory", address(factory));
        string memory json = vm.serializeString(root, "stocks", stocksJson);

        string memory path = vm.envOr("ADDRESSES_OUT", string("../backend/addresses.json"));
        vm.writeJson(json, path);
        console.log("Wrote", path);
    }
}

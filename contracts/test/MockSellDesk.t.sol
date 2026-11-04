// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {MockRouter} from "../src/MockRouter.sol";
import {MockSellDesk} from "../src/MockSellDesk.sol";
import {MockStock} from "../src/MockStock.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ScrollBasket} from "../src/ScrollBasket.sol";
import {StockFactory} from "../src/StockFactory.sol";
import {MockVenue} from "../src/venues/MockVenue.sol";

contract MockSellDeskTest is Test {
    MockUSDC usdc;
    MockRouter router;
    ScrollBasket basket;
    MockSellDesk desk;
    address nvda;

    address user = makeAddr("user");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockUSDC();
        router = new MockRouter(usdc);
        basket = new ScrollBasket(usdc, new MockVenue(router));
        StockFactory factory = new StockFactory(router);
        router.setFactory(address(factory));
        nvda = factory.create("NVDAx", 200e6);
        desk = new MockSellDesk(router);

        vm.startPrank(user);
        usdc.faucet();
        usdc.approve(address(basket), type(uint256).max);
        basket.buy(nvda, 20e6, 0, ScrollBasket.Source.HIGHLIGHT);
        IERC20(nvda).approve(address(desk), type(uint256).max);
        vm.stopPrank();
    }

    function test_sellingEverythingReturnsTheMoney() public {
        vm.prank(user);
        uint256 out = desk.sell(nvda, 0.1e18, 0);

        assertEq(out, 20e6);
        assertEq(usdc.balanceOf(user), 1_000e6);
        assertEq(IERC20(nvda).balanceOf(user), 0);
    }

    function test_sellingPartOfAHolding() public {
        vm.prank(user);
        desk.sell(nvda, 0.025e18, 0);

        assertEq(usdc.balanceOf(user), 985e6);
        assertEq(IERC20(nvda).balanceOf(user), 0.075e18);
    }

    function test_paysAtTheCurrentPrice() public {
        router.setPrice(nvda, 400e6);
        vm.prank(user);
        assertEq(desk.sell(nvda, 0.1e18, 0), 40e6);
    }

    function test_paysMoreThanOneFaucetCall() public {
        router.setPrice(nvda, 25_000e6);
        vm.prank(user);
        assertEq(desk.sell(nvda, 0.1e18, 0), 2_500e6);
        assertEq(usdc.balanceOf(user), 980e6 + 2_500e6);
    }

    function test_emitsScrollSell() public {
        vm.expectEmit(true, true, false, true, address(desk));
        emit MockSellDesk.ScrollSell(user, nvda, 0.1e18, 20e6);
        vm.prank(user);
        desk.sell(nvda, 0.1e18, 0);
    }

    function test_cantSellWhatYouDontHold() public {
        vm.prank(stranger);
        IERC20(nvda).approve(address(desk), type(uint256).max);
        vm.expectRevert();
        vm.prank(stranger);
        desk.sell(nvda, 1e18, 0);
    }

    function test_cantSellMoreThanYouHold() public {
        vm.expectRevert();
        vm.prank(user);
        desk.sell(nvda, 0.2e18, 0);
        assertEq(IERC20(nvda).balanceOf(user), 0.1e18);
    }

    function test_cantSellAnotherUsersStock() public {
        vm.expectRevert();
        vm.prank(stranger);
        desk.sell(nvda, 0.1e18, 0);
        assertEq(IERC20(nvda).balanceOf(user), 0.1e18);
    }

    function test_refusesUnlistedTokens() public {
        MockStock fake = new MockStock("Fake", "FAKE", address(this));
        fake.mint(stranger, 1e18);
        vm.startPrank(stranger);
        fake.approve(address(desk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(MockSellDesk.UnpricedStock.selector, address(fake)));
        desk.sell(address(fake), 1e18, 0);
        vm.stopPrank();
    }

    function test_refusesZeroAndDust() public {
        vm.startPrank(user);
        vm.expectRevert(MockSellDesk.ZeroAmount.selector);
        desk.sell(nvda, 0, 0);
        vm.expectRevert(MockSellDesk.ZeroAmount.selector);
        desk.sell(nvda, 1, 0);
        vm.stopPrank();
    }

    function test_respectsMinUsdc() public {
        vm.expectRevert(abi.encodeWithSelector(MockSellDesk.InsufficientOutput.selector, 20e6, 21e6));
        vm.prank(user);
        desk.sell(nvda, 0.1e18, 21e6);
    }
}

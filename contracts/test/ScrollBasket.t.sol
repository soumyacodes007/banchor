// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {MockRouter} from "../src/MockRouter.sol";
import {MockStock} from "../src/MockStock.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ScrollBasket} from "../src/ScrollBasket.sol";
import {StockFactory} from "../src/StockFactory.sol";
import {IStockVenue} from "../src/venues/IStockVenue.sol";
import {MockVenue} from "../src/venues/MockVenue.sol";

/// A venue that isn't the mock one, standing in for a real order book.
contract OtherVenue is IStockVenue {
    IERC20 immutable usdc;
    MockRouter immutable router;
    uint256 public calls;

    constructor(MockRouter _router) {
        router = _router;
        usdc = _router.usdc();
        usdc.approve(address(_router), type(uint256).max);
    }

    function buy(address stock, uint256 usdcIn, uint256 minOut, address to) external returns (uint256) {
        calls++;
        usdc.transferFrom(msg.sender, address(this), usdcIn);
        return router.swapExactIn(stock, usdcIn, minOut, to);
    }
}

contract ScrollBasketTest is Test {
    MockUSDC usdc;
    MockRouter router;
    MockVenue venue;
    ScrollBasket basket;
    StockFactory factory;
    address meta;
    address googl;

    address user = makeAddr("user");
    address friend = makeAddr("friend");
    address stranger = makeAddr("stranger");

    ScrollBasket.Source constant SCROLL = ScrollBasket.Source.SCROLL;
    ScrollBasket.Source constant HIGHLIGHT = ScrollBasket.Source.HIGHLIGHT;
    ScrollBasket.Source constant COPY = ScrollBasket.Source.COPY;
    ScrollBasket.Source constant GIFT = ScrollBasket.Source.GIFT;

    function setUp() public {
        usdc = new MockUSDC();
        router = new MockRouter(usdc);
        venue = new MockVenue(router);
        basket = new ScrollBasket(usdc, venue);
        factory = new StockFactory(router);
        router.setFactory(address(factory));
        meta = factory.create("METAx", 600e6);
        googl = factory.create("GOOGLx", 180e6);

        vm.startPrank(user);
        usdc.faucet();
        usdc.approve(address(basket), type(uint256).max);
        vm.stopPrank();
    }

    function balance(address stock, address owner) internal view returns (uint256) {
        return IERC20(stock).balanceOf(owner);
    }

    function one(address stock) internal pure returns (address[] memory stocks) {
        stocks = new address[](1);
        stocks[0] = stock;
    }

    function one(uint256 value) internal pure returns (uint256[] memory values) {
        values = new uint256[](1);
        values[0] = value;
    }

    function two(uint256 a, uint256 b) internal pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = a;
        values[1] = b;
    }

    function pair() internal view returns (address[] memory stocks) {
        stocks = new address[](2);
        stocks[0] = meta;
        stocks[1] = googl;
    }

    // MockUSDC

    function test_faucetMintsOneThousand() public {
        vm.prank(stranger);
        usdc.faucet();
        assertEq(usdc.balanceOf(stranger), 1_000e6);
        assertEq(uint256(usdc.decimals()), 6);
    }

    // MockRouter and MockStock

    function test_tenCentsAtSixHundredReturnsPrdAmount() public {
        vm.prank(user);
        basket.buy(meta, 0.1e6, 0, SCROLL);
        assertEq(balance(meta, user), 166666666666666);
    }

    function test_onlyOwnerOrFactoryCanSetPrices() public {
        vm.expectRevert(abi.encodeWithSelector(MockRouter.NotAllowed.selector, stranger));
        vm.prank(stranger);
        router.setPrice(meta, 1);
    }

    function test_pricesCanChangeOnDemoMorning() public {
        router.setPrice(meta, 300e6);
        vm.prank(user);
        basket.buy(meta, 3e6, 0, SCROLL);
        assertEq(balance(meta, user), 0.01e18);
    }

    // StockFactory

    function test_factoryListsAStockOnlyTheRouterCanMint() public {
        address nvda = factory.create("NVDAx", 187.2e6);

        assertEq(factory.stockOf("NVDAx"), nvda);
        assertEq(factory.stockCount(), 3);
        assertEq(router.prices(nvda), 187.2e6);
        assertEq(MockStock(nvda).symbol(), "NVDAx");

        vm.prank(user);
        basket.buy(nvda, 187.2e6, 0, HIGHLIGHT);
        assertEq(balance(nvda, user), 1e18);

        vm.expectRevert(abi.encodeWithSelector(MockStock.OnlyRouter.selector, stranger));
        vm.prank(stranger);
        MockStock(nvda).mint(stranger, 1e18);

        vm.expectRevert(abi.encodeWithSelector(MockStock.OnlyRouter.selector, address(this)));
        MockStock(nvda).mint(address(this), 1e18);
    }

    function test_factoryRefusesDuplicatesAndStrangers() public {
        vm.expectRevert(abi.encodeWithSelector(StockFactory.AlreadyListed.selector, "METAx"));
        factory.create("METAx", 1e6);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.create("EVILx", 1e6);
    }

    // buy

    function test_buyEmitsItsSource() public {
        vm.expectEmit(true, true, true, true, address(basket));
        emit ScrollBasket.ScrollBuy(user, meta, 6e6, 0.01e18, HIGHLIGHT, address(0));
        vm.prank(user);
        basket.buy(meta, 6e6, 0, HIGHLIGHT);
    }

    function test_buyRefusesSourcesThatNeedARef() public {
        vm.startPrank(user);
        vm.expectRevert(ScrollBasket.WrongSource.selector);
        basket.buy(meta, 1e6, 0, COPY);
        vm.expectRevert(ScrollBasket.WrongSource.selector);
        basket.buy(meta, 1e6, 0, GIFT);
        vm.stopPrank();
    }

    function test_buyRevertsOnZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(ScrollBasket.ZeroAmount.selector, 0));
        vm.prank(user);
        basket.buy(meta, 0, 0, SCROLL);
    }

    function test_buyRevertsBelowMinOut() public {
        vm.expectRevert(abi.encodeWithSelector(MockRouter.InsufficientOutput.selector, 0.01e18, 0.02e18));
        vm.prank(user);
        basket.buy(meta, 6e6, 0.02e18, HIGHLIGHT);
    }

    // buyBasket

    function test_basketBuysEveryStockStraightToTheUser() public {
        vm.prank(user);
        uint256[] memory outs = basket.buyBasket(pair(), two(8.4e6, 3e6), two(0, 0), SCROLL, address(0));

        assertEq(balance(meta, user), outs[0]);
        assertEq(balance(googl, user), outs[1]);
        assertEq(balance(meta, user), 0.014e18);
        assertEq(usdc.balanceOf(user), 1_000e6 - 11.4e6);
    }

    function test_nothingStaysInTheBasket() public {
        vm.prank(user);
        basket.buyBasket(pair(), two(8.4e6, 3e6), two(0, 0), SCROLL, address(0));

        assertEq(usdc.balanceOf(address(basket)), 0);
        assertEq(usdc.balanceOf(address(venue)), 0);
        assertEq(balance(meta, address(basket)), 0);
        assertEq(usdc.allowance(address(basket), address(venue)), 0);
        assertEq(usdc.balanceOf(address(router)), 11.4e6);
    }

    function test_copyEmitsOneEventPerStockWithTheRef() public {
        vm.expectEmit(true, true, true, true, address(basket));
        emit ScrollBasket.ScrollBuy(user, meta, 6e6, 0.01e18, COPY, friend);
        vm.expectEmit(true, true, true, true, address(basket));
        emit ScrollBasket.ScrollBuy(user, googl, 1.8e6, 0.01e18, COPY, friend);
        vm.prank(user);
        basket.buyBasket(pair(), two(6e6, 1.8e6), two(0, 0), COPY, friend);
    }

    function test_refMustMatchTheSource() public {
        address[] memory stocks = pair();
        uint256[] memory amounts = two(1e6, 1e6);
        uint256[] memory minOuts = two(0, 0);
        vm.startPrank(user);
        vm.expectRevert(ScrollBasket.WrongSource.selector);
        basket.buyBasket(stocks, amounts, minOuts, SCROLL, friend);
        vm.expectRevert(ScrollBasket.WrongSource.selector);
        basket.buyBasket(stocks, amounts, minOuts, COPY, address(0));
        vm.expectRevert(ScrollBasket.WrongSource.selector);
        basket.buyBasket(stocks, amounts, minOuts, GIFT, friend);
        vm.stopPrank();
    }

    function test_basketRevertsOnMismatchedArrays() public {
        address[] memory stocks = pair();
        vm.startPrank(user);
        vm.expectRevert(ScrollBasket.LengthMismatch.selector);
        basket.buyBasket(stocks, one(1e6), two(0, 0), SCROLL, address(0));
        vm.expectRevert(ScrollBasket.LengthMismatch.selector);
        basket.buyBasket(stocks, two(1e6, 1e6), one(0), SCROLL, address(0));
        vm.stopPrank();
    }

    function test_basketRevertsWhenEmpty() public {
        vm.expectRevert(ScrollBasket.EmptyBasket.selector);
        vm.prank(user);
        basket.buyBasket(new address[](0), new uint256[](0), new uint256[](0), SCROLL, address(0));
    }

    function test_basketRevertsOnZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(ScrollBasket.ZeroAmount.selector, 1));
        vm.prank(user);
        basket.buyBasket(pair(), two(1e6, 0), two(0, 0), SCROLL, address(0));
    }

    function test_unpricedStockRevertsAndKeepsTheUsersMoney() public {
        MockStock unpriced = new MockStock("Unpriced", "NOPE", address(router));
        address[] memory stocks = pair();
        stocks[1] = address(unpriced);

        vm.expectRevert(abi.encodeWithSelector(MockRouter.UnpricedStock.selector, address(unpriced)));
        vm.prank(user);
        basket.buyBasket(stocks, two(1e6, 1e6), two(0, 0), SCROLL, address(0));

        assertEq(usdc.balanceOf(user), 1_000e6);
        assertEq(balance(meta, user), 0);
    }

    function test_revertsWithoutEnoughUsdc() public {
        vm.expectRevert();
        vm.prank(user);
        basket.buy(meta, 1_001e6, 0, SCROLL);
    }

    function test_nobodyCanSpendAnotherUsersApproval() public {
        vm.expectRevert();
        vm.prank(stranger);
        basket.buy(meta, 1e6, 0, SCROLL);
        assertEq(usdc.balanceOf(user), 1_000e6);
    }

    // buyFor

    function test_buyForSendsToAThirdPartyAndChargesTheBuyer() public {
        vm.expectEmit(true, true, true, true, address(basket));
        emit ScrollBasket.ScrollBuy(user, meta, 6e6, 0.01e18, GIFT, friend);
        vm.prank(user);
        basket.buyFor(friend, meta, 6e6, 0);

        assertEq(balance(meta, friend), 0.01e18);
        assertEq(balance(meta, user), 0);
        assertEq(usdc.balanceOf(user), 1_000e6 - 6e6);
    }

    function test_buyForRefusesTheZeroAddress() public {
        vm.expectRevert(ScrollBasket.ZeroAddress.selector);
        vm.prank(user);
        basket.buyFor(address(0), meta, 1e6, 0);
    }

    // Venues

    function test_movingAStockToAnotherVenueIsOneCall() public {
        OtherVenue other = new OtherVenue(router);
        basket.setVenue(meta, other);
        assertEq(address(basket.venueOf(meta)), address(other));
        assertEq(address(basket.venueOf(googl)), address(venue));

        vm.prank(user);
        basket.buyBasket(pair(), two(6e6, 1.8e6), two(0, 0), SCROLL, address(0));

        assertEq(other.calls(), 1);
        assertEq(balance(meta, user), 0.01e18);
        assertEq(balance(googl, user), 0.01e18);
    }

    function test_killSwitchReturnsAStockToTheDefaultVenue() public {
        OtherVenue other = new OtherVenue(router);
        basket.setVenue(meta, other);
        basket.setVenue(meta, IStockVenue(address(0)));

        vm.prank(user);
        basket.buy(meta, 6e6, 0, SCROLL);
        assertEq(other.calls(), 0);
        assertEq(balance(meta, user), 0.01e18);
    }

    function test_onlyOwnerCanChangeVenues() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        basket.setVenue(meta, IStockVenue(stranger));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        basket.setDefaultVenue(IStockVenue(stranger));
        vm.stopPrank();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStockVenue} from "./venues/IStockVenue.sol";

/// @notice Every buy goes through here: takes the user's USDC and sends the stock
/// straight to its owner, tagging which loop caused it so each can be counted
/// onchain. It never holds funds between calls.
contract ScrollBasket is Ownable {
    using SafeERC20 for IERC20;

    enum Source {
        SCROLL,
        HIGHLIGHT,
        COPY,
        GIFT
    }

    IERC20 public immutable usdc;
    IStockVenue public defaultVenue;

    /// @notice Stocks that trade somewhere other than `defaultVenue`.
    mapping(address stock => IStockVenue venue) public venueOverride;

    /// @param user Who paid.
    /// @param ref For COPY, whose roast card was copied. For GIFT, who received
    /// the stock. Otherwise zero.
    event ScrollBuy(
        address indexed user,
        address indexed stock,
        uint256 usdc,
        uint256 out,
        Source indexed source,
        address ref
    );
    event VenueSet(address indexed stock, address venue);

    error LengthMismatch();
    error EmptyBasket();
    error ZeroAmount(uint256 index);
    error ZeroAddress();
    error WrongSource();

    constructor(IERC20 _usdc, IStockVenue _defaultVenue) Ownable(msg.sender) {
        usdc = _usdc;
        defaultVenue = _defaultVenue;
    }

    /// @notice Moves a stock to another venue. Zero returns it to the default.
    function setVenue(address stock, IStockVenue venue) external onlyOwner {
        venueOverride[stock] = venue;
        emit VenueSet(stock, address(venue));
    }

    function setDefaultVenue(IStockVenue venue) external onlyOwner {
        if (address(venue) == address(0)) revert ZeroAddress();
        defaultVenue = venue;
    }

    function venueOf(address stock) public view returns (IStockVenue) {
        IStockVenue venue = venueOverride[stock];
        return address(venue) == address(0) ? defaultVenue : venue;
    }

    /// @notice One stock, for a highlight or a chunk of scrolling.
    /// @param minOut Least stock to accept. Zero on testnet, where prices are
    /// fixed. On mainnet this must come from the live price.
    function buy(address stock, uint256 amount, uint256 minOut, Source source) external returns (uint256 out) {
        // These need a ref, so they go through buyBasket and buyFor.
        if (source == Source.COPY || source == Source.GIFT) revert WrongSource();
        if (amount == 0) revert ZeroAmount(0);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        out = _buy(stock, amount, minOut, msg.sender, source, address(0));
    }

    /// @notice Several stocks for one payment.
    /// @param ref Whose roast card this copies, when `source` is COPY.
    function buyBasket(
        address[] calldata stocks,
        uint256[] calldata amounts,
        uint256[] calldata minOuts,
        Source source,
        address ref
    ) external returns (uint256[] memory outs) {
        if (stocks.length != amounts.length || stocks.length != minOuts.length) revert LengthMismatch();
        if (stocks.length == 0) revert EmptyBasket();
        if (source == Source.GIFT) revert WrongSource();
        // A ref on anything else would fake the referral count.
        if ((source == Source.COPY) != (ref != address(0))) revert WrongSource();

        uint256 total;
        for (uint256 i; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroAmount(i);
            total += amounts[i];
        }
        usdc.safeTransferFrom(msg.sender, address(this), total);

        outs = new uint256[](stocks.length);
        for (uint256 i; i < stocks.length; i++) {
            outs[i] = _buy(stocks[i], amounts[i], minOuts[i], msg.sender, source, ref);
        }
    }

    /// @notice Buys a stock for someone else.
    function buyFor(address to, address stock, uint256 amount, uint256 minOut) external returns (uint256 out) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount(0);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        out = _buy(stock, amount, minOut, to, Source.GIFT, to);
    }

    function _buy(address stock, uint256 amount, uint256 minOut, address to, Source source, address ref)
        private
        returns (uint256 out)
    {
        IStockVenue venue = venueOf(stock);
        usdc.forceApprove(address(venue), amount);
        out = venue.buy(stock, amount, minOut, to);
        emit ScrollBuy(msg.sender, stock, amount, out, source, ref);
    }
}

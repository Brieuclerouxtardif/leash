// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LeashPool — minimal x*y=k pool (0.3% fee) for testnet demos.
/// @notice Testnets have no real liquidity, so LEASH ships its own pool. Anyone can swap,
/// which is the point: an attacker can move its price, and the vault must refuse to trade at it.
contract LeashPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;

    event Swap(address indexed sender, address tokenIn, uint256 amountIn, uint256 amountOut, address to);
    event Liquidity(address indexed sender, uint256 amount0, uint256 amount1);

    constructor(IERC20 token0_, IERC20 token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    /// Donation-style liquidity: no LP shares, no withdrawal. Demo only.
    function addLiquidity(uint256 amount0, uint256 amount1) external nonReentrant {
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
        emit Liquidity(msg.sender, amount0, amount1);
    }

    function quote(address tokenIn, uint256 amountIn) public view returns (uint256) {
        (uint256 rIn, uint256 rOut) = tokenIn == address(token0) ? (reserve0, reserve1) : (reserve1, reserve0);
        require(tokenIn == address(token0) || tokenIn == address(token1), "token");
        uint256 inWithFee = amountIn * (10_000 - FEE_BPS);
        return inWithFee * rOut / (rIn * 10_000 + inWithFee);
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        amountOut = quote(tokenIn, amountIn);
        require(amountOut >= minOut, "slippage");
        bool zeroForOne = tokenIn == address(token0);
        (IERC20 tIn, IERC20 tOut) = zeroForOne ? (token0, token1) : (token1, token0);
        tIn.safeTransferFrom(msg.sender, address(this), amountIn);
        if (zeroForOne) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }
        tOut.safeTransfer(to, amountOut);
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }
}

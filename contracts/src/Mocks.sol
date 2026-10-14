// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test token with no market value. Named "Test ..." on purpose: it must never pass for a real asset.
contract TestToken is ERC20 {
    uint8 private immutable dec;
    address public immutable minter;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        dec = decimals_;
        minter = msg.sender;
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "minter");
        _mint(to, amount);
    }
}

/// Chainlink-shaped price feed for local tests. On Sepolia LEASH reads the real Chainlink ETH/USD feed.
contract MockAggregator {
    uint8 public constant decimals = 8;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        roundId += 1;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}

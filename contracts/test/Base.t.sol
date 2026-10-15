// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LeashVault, IAggregatorV3, ILeashPool} from "../src/LeashVault.sol";
import {LeashPool} from "../src/LeashPool.sol";
import {TestToken, MockAggregator} from "../src/Mocks.sol";

abstract contract LeashBase is Test {
    TestToken usd;
    TestToken eth;
    MockAggregator feed;
    LeashPool pool;
    LeashVault vault;

    address owner;
    uint256 ownerPk;
    address agent = makeAddr("agent");
    address guardian = makeAddr("guardian");
    address attacker = makeAddr("attacker");
    address whale = makeAddr("whale");
    address landlord = makeAddr("landlord");
    address utility = makeAddr("utility");

    uint256 constant PRICE = 2500e8; // ETH/USD, 8 decimals like Chainlink
    uint128 constant BUDGET = 5000e6; // half the vault's tUSD: the daily cap alone would let 30 days take it all

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        (owner, ownerPk) = makeAddrAndKey("owner");
        usd = new TestToken("Test Dollar", "tUSD", 6);
        eth = new TestToken("Test Ether", "tETH", 18);
        feed = new MockAggregator();
        feed.set(int256(PRICE), vm.getBlockTimestamp());

        pool = new LeashPool(usd, eth);
        usd.mint(whale, 2_000_000e6);
        eth.mint(whale, 800e18);
        vm.startPrank(whale);
        usd.approve(address(pool), type(uint256).max);
        eth.approve(address(pool), type(uint256).max);
        pool.addLiquidity(1_000_000e6, 400e18);
        vm.stopPrank();

        vault = new LeashVault(owner, usd, eth, IAggregatorV3(address(feed)));
        usd.mint(address(vault), 10_000e6);
        eth.mint(address(vault), 1e18);

        vm.startPrank(owner);
        vault.setAgent(agent, uint64(vm.getBlockTimestamp() + 30 days));
        vault.setAgentBudget(0, BUDGET);
        vault.setGuardian(guardian);
        vault.setPool(ILeashPool(address(pool)));
        vault.setLimits(LeashVault.Limits({payPerTx: 1000e6, payDaily: 1500e6, swapPerTx: 500e6, swapDaily: 1000e6}));
        vault.setRisk(LeashVault.Risk({maxSlippageBps: 100, maxRiskBps: 4000, maxOracleAge: 3600}));
        vault.setPayee(landlord, 900e6);
        vault.setPayee(utility, 150e6);
        vm.stopPrank();
    }

    function sign(uint256 pk, address to, uint256 amount, bytes32 opId, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, vault.mandateDigest(to, amount, opId, deadline));
        return abi.encodePacked(r, s, v);
    }
}

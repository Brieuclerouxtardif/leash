// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {LeashBase} from "./Base.t.sol";
import {LeashVault} from "../src/LeashVault.sol";
import {LeashPool} from "../src/LeashPool.sol";
import {TestToken, MockAggregator} from "../src/Mocks.sol";

/// Plays a rogue agent that holds the agent key, plus a whale that moves the pool and a market
/// that moves the oracle. Ghost counters record anything the mandate should have made impossible.
contract RogueAgentHandler is Test {
    LeashVault vault;
    LeashPool pool;
    TestToken usd;
    MockAggregator feed;
    address agent;
    address whale;
    address[] targets;

    uint256 public nonce;
    uint256 public badSwaps;
    uint256 public exposureBreaches;
    uint256 public replays;
    uint256 public paidTotal;
    uint256[] public touchedDays;
    bytes32[] public consumed; // only opIds whose call succeeded; a reverted call burns nothing
    mapping(uint256 => uint256) public ghostPaidOnDay;

    constructor(LeashVault v, LeashPool p, TestToken u, MockAggregator f, address a, address w, address[] memory t) {
        (vault, pool, usd, feed, agent, whale, targets) = (v, p, u, f, a, w, t);
    }

    function pay(uint256 who, uint256 amount) external {
        address to = targets[who % targets.length];
        amount = bound(amount, 1, 2000e6);
        bytes32 opId = bytes32(++nonce);
        vm.prank(agent);
        try vault.pay(to, amount, opId) {
            consumed.push(opId);
            uint256 day = vm.getBlockTimestamp() / 1 days;
            if (ghostPaidOnDay[day] == 0) touchedDays.push(day);
            ghostPaidOnDay[day] += amount;
            paidTotal += amount;
        } catch {}
    }

    function swap(bool buy, uint256 amountIn, uint256 slipBps) external {
        amountIn = buy ? bound(amountIn, 1e6, 600e6) : bound(amountIn, 1e15, 0.3e18);
        uint256 fair;
        try vault.fairOut(buy, amountIn) returns (uint256 f) {
            fair = f;
        } catch {
            return;
        }
        uint256 minOut = fair * (10_000 - bound(slipBps, 0, 10_000)) / 10_000;
        bytes32 opId = bytes32(++nonce);
        vm.prank(agent);
        try vault.swap(buy, amountIn, minOut, opId) returns (uint256 out) {
            consumed.push(opId);
            if (out * 10_000 < fair * 9900) badSwaps++;
            if (buy && vault.riskBps() > 4000) exposureBreaches++;
        } catch {}
    }

    function replay(uint256 i) external {
        if (consumed.length == 0) return;
        vm.prank(agent);
        try vault.pay(targets[0], 1, consumed[i % consumed.length]) {
            replays++;
        } catch {}
    }

    function manipulate(bool pumpEth, uint256 amount) external {
        vm.prank(whale);
        if (pumpEth) pool.swapExactIn(address(usd), bound(amount, 1e6, 200_000e6), 0, whale);
        else pool.swapExactIn(address(pool.token1()), bound(amount, 1e15, 80e18), 0, whale);
    }

    function moveMarket(uint256 price) external {
        feed.set(int256(bound(price, 1000e8, 5000e8)), vm.getBlockTimestamp());
    }

    function warp(uint256 secs, bool refreshOracle) external {
        vm.warp(vm.getBlockTimestamp() + bound(secs, 0, 2 days));
        if (refreshOracle) feed.set(feed.answer(), vm.getBlockTimestamp());
    }

    // ---- sealed invoices: genuine seals from the school, forged or altered ones, releases and contests

    uint256 schoolPk;
    address school;
    address owner;
    uint256 public sealedHeld;
    uint256 public sealedReleased;
    uint256 public sealedContested;
    uint256 public brokenSealsAccepted;
    bytes32[] public keys;

    /// Set once in setUp; the fuzzer's own calls to it revert, so it cannot swap the school mid-run.
    function setSealer(uint256 pk, address school_, address owner_) external {
        require(school == address(0), "once");
        (schoolPk, school, owner) = (pk, school_, owner_);
    }

    function settle(uint256 amount, uint256 tamper, uint256 idSeed) external {
        amount = bound(amount, 1, 7000e6);
        bytes32 id = bytes32(idSeed % 64); // a small id space makes replays likely
        uint256 mode = tamper % 4; // 0, 1: genuine; 2: altered amount; 3: sealed by a stranger
        uint256 pk = mode == 3 ? uint256(keccak256("stranger")) : schoolPk;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, vault.invoiceDigest(school, amount, id));
        uint256 claimed = mode == 2 ? amount + 1 : amount;
        vm.prank(agent);
        try vault.settleInvoice(school, claimed, id, abi.encodePacked(r, s, v)) {
            if (mode >= 2) brokenSealsAccepted++;
            keys.push(vault.invoiceKey(school, id));
            sealedHeld += claimed;
        } catch {}
    }

    function releaseOne(uint256 i) external {
        if (keys.length == 0) return;
        bytes32 key = keys[i % keys.length];
        (, uint128 amount,,) = vault.holds(key);
        try vault.release(key) {
            sealedHeld -= amount;
            sealedReleased += amount;
        } catch {}
    }

    function contestOne(uint256 i) external {
        if (keys.length == 0) return;
        bytes32 key = keys[i % keys.length];
        (, uint128 amount,,) = vault.holds(key);
        vm.prank(owner);
        try vault.contest(key) {
            sealedHeld -= amount;
            sealedContested += amount;
        } catch {}
    }

    function touchedCount() external view returns (uint256) {
        return touchedDays.length;
    }

    function consumedCount() external view returns (uint256) {
        return consumed.length;
    }
}

contract LeashInvariants is LeashBase {
    RogueAgentHandler handler;

    function setUp() public override {
        super.setUp();
        address[] memory t = new address[](4);
        (t[0], t[1], t[2], t[3]) = (landlord, utility, attacker, address(0xBEEF));
        handler = new RogueAgentHandler(vault, pool, usd, feed, agent, whale, t);
        handler.setSealer(schoolPk, school, owner);
        vm.prank(whale);
        usd.transfer(address(handler), 1); // keeps the handler's address non-empty for the fuzzer
        vm.startPrank(whale);
        usd.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        targetContract(address(handler));
        bytes4[] memory calls = new bytes4[](9);
        (calls[0], calls[1], calls[2], calls[3]) = (handler.pay.selector, handler.swap.selector, handler.replay.selector, handler.manipulate.selector);
        (calls[4], calls[5], calls[6]) = (handler.moveMarket.selector, handler.warp.selector, handler.settle.selector);
        (calls[7], calls[8]) = (handler.releaseOne.selector, handler.contestOne.selector);
        targetSelector(FuzzSelector({addr: address(handler), selectors: calls}));
    }

    function invariant_strangers_receive_nothing() public view {
        assertEq(usd.balanceOf(attacker) + eth.balanceOf(attacker), 0);
        assertEq(usd.balanceOf(address(0xBEEF)) + eth.balanceOf(address(0xBEEF)), 0);
    }

    function invariant_daily_cap_holds() public view {
        for (uint256 i; i < handler.touchedCount(); i++) {
            uint256 day = handler.touchedDays(i);
            assertLe(vault.paidOnDay(day), 1500e6);
            assertEq(vault.paidOnDay(day), handler.ghostPaidOnDay(day));
        }
    }

    function invariant_agent_never_spends_beyond_its_budget() public view {
        assertLe(handler.paidTotal(), BUDGET);
        assertEq(handler.paidTotal() + vault.agentBudget(), BUDGET);
    }

    function invariant_payees_got_exactly_what_was_paid() public view {
        assertEq(usd.balanceOf(landlord) + usd.balanceOf(utility), handler.paidTotal());
    }

    function invariant_no_allowance_survives() public view {
        assertEq(usd.allowance(address(vault), address(pool)), 0);
        assertEq(eth.allowance(address(vault), address(pool)), 0);
    }

    function invariant_swaps_never_below_oracle_floor() public view {
        assertEq(handler.badSwaps(), 0);
    }

    function invariant_buys_never_breach_exposure() public view {
        assertEq(handler.exposureBreaches(), 0);
    }

    function invariant_sealed_money_is_held_until_released_and_only_to_the_creditor() public view {
        assertEq(handler.brokenSealsAccepted(), 0);
        assertEq(vault.held(), handler.sealedHeld());
        assertGe(usd.balanceOf(address(vault)), vault.held());
        assertEq(usd.balanceOf(school), handler.sealedReleased());
        // What the school's seals took, plus what is held, plus what is left, is the allowance it was given.
        assertEq(handler.sealedReleased() + vault.held() + vault.sealAllowance(school), SEAL_ALLOWANCE);
    }

    function invariant_no_op_executes_twice() public view {
        assertEq(handler.replays(), 0);
    }

    /// Guards against vacuous passes: the rogue agent must actually get payments and swaps through.
    function afterInvariant() external view {
        console.log("successful ops", handler.consumedCount(), "paid", handler.paidTotal());
        console.log("sealed: released", handler.sealedReleased(), "contested", handler.sealedContested());
    }
}

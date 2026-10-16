// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LeashBase} from "./Base.t.sol";
import {LeashVault, IAggregatorV3, ILeashPool} from "../src/LeashVault.sol";

contract PayTest is LeashBase {
    function test_pay_ok() public {
        vm.prank(agent);
        vault.pay(landlord, 800e6, "rent-oct");
        assertEq(usd.balanceOf(landlord), 800e6);
        (, uint256 paid,) = vault.today();
        assertEq(paid, 800e6);
    }

    function test_pay_rejects_non_agent() public {
        vm.prank(attacker);
        vm.expectRevert(LeashVault.NotAgent.selector);
        vault.pay(landlord, 1e6, "x");
    }

    function test_pay_rejects_non_payee() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.PayeeNotAllowed.selector, attacker));
        vault.pay(attacker, 1e6, "x");
    }

    function test_pay_rejects_above_payee_cap() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AbovePayeeCap.selector, 151e6, 150e6));
        vault.pay(utility, 151e6, "x");
    }

    function test_pay_rejects_above_per_tx() public {
        vm.prank(owner);
        vault.setPayee(landlord, 5000e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AbovePerTxLimit.selector, 1001e6, 1000e6));
        vault.pay(landlord, 1001e6, "x");
    }

    function test_pay_daily_limit_and_reset() public {
        vm.startPrank(agent);
        vault.pay(landlord, 900e6, "a");
        vault.pay(landlord, 500e6, "b");
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AboveDailyLimit.selector, 1550e6, 1500e6));
        vault.pay(utility, 150e6, "c");
        vm.warp(vm.getBlockTimestamp() + 1 days);
        feed.set(int256(PRICE), vm.getBlockTimestamp());
        vault.pay(utility, 150e6, "c");
        vm.stopPrank();
        assertEq(usd.balanceOf(utility), 150e6);
    }

    function test_pay_rejects_replayed_op() public {
        vm.startPrank(agent);
        vault.pay(utility, 10e6, "same");
        vm.expectRevert(abi.encodeWithSelector(LeashVault.OpAlreadyUsed.selector, bytes32("same")));
        vault.pay(utility, 10e6, "same");
        vm.stopPrank();
    }

    function test_pay_rejects_expired_agent() public {
        vm.warp(vm.getBlockTimestamp() + 31 days);
        vm.prank(agent);
        vm.expectRevert(LeashVault.AgentInactive.selector);
        vault.pay(utility, 10e6, "x");
    }

    function test_pay_rejects_zero() public {
        vm.prank(agent);
        vm.expectRevert(LeashVault.ZeroAmount.selector);
        vault.pay(utility, 0, "x");
    }

    function test_guardian_pauses_but_cannot_unpause() public {
        vm.prank(guardian);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(LeashVault.VaultPaused.selector);
        vault.pay(utility, 10e6, "x");
        vm.prank(guardian);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.unpause();
        vm.prank(attacker);
        vm.expectRevert(LeashVault.NotGuardian.selector);
        vault.pause();
    }

    function test_revoke_kills_agent() public {
        vm.prank(owner);
        vault.revokeAgent();
        assertEq(vault.agentBudget(), 0);
        vm.prank(agent);
        vm.expectRevert(LeashVault.NotAgent.selector);
        vault.pay(utility, 10e6, "x");
    }

    /// The daily cap alone would let a stolen key take 1,500 a day until expiry: 30 days, the whole vault.
    function test_budget_bounds_the_key_for_life() public {
        uint256 paid;
        for (uint256 d; d < 30; d++) {
            vm.prank(agent);
            try vault.pay(landlord, 900e6, keccak256(abi.encode("rent", d))) {
                paid += 900e6;
            } catch (bytes memory err) {
                assertEq(err, abi.encodeWithSelector(LeashVault.AboveAgentBudget.selector, 900e6, 500e6));
                break;
            }
            vm.warp(vm.getBlockTimestamp() + 1 days);
        }
        assertEq(paid, 4500e6);
        assertEq(vault.agentBudget(), 500e6);
        vm.prank(agent);
        vault.pay(utility, 150e6, "last"); // what is left can still be spent, and nothing more
        assertEq(usd.balanceOf(landlord) + usd.balanceOf(utility), BUDGET - 350e6);
    }

    function test_owner_reloads_the_budget() public {
        vm.prank(owner);
        vault.setAgentBudget(BUDGET, 100e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AboveAgentBudget.selector, 101e6, 100e6));
        vault.pay(landlord, 101e6, "x");
        vm.prank(owner);
        vault.setAgentBudget(100e6, 800e6);
        vm.prank(agent);
        vault.pay(landlord, 800e6, "x");
        assertEq(vault.agentBudget(), 0);
    }

    /// The owner saw 100 left and reloads to 800; the agent's payment mined first must not be forgotten (SECURITY.md R16).
    function test_budget_reload_reverts_if_the_agent_spent_meanwhile() public {
        vm.prank(owner);
        vault.setAgentBudget(BUDGET, 100e6);
        vm.prank(agent);
        vault.pay(utility, 100e6, "front-run");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.BudgetChanged.selector, 100e6, 0));
        vault.setAgentBudget(100e6, 800e6);
        assertEq(vault.agentBudget(), 0);
    }

    function test_new_agent_key_starts_with_no_budget() public {
        address agent2 = makeAddr("agent2");
        vm.prank(owner);
        vault.setAgent(agent, uint64(vm.getBlockTimestamp() + 7 days)); // renewing the same key keeps it
        assertEq(vault.agentBudget(), BUDGET);
        vm.prank(owner);
        vault.setAgent(agent2, uint64(vm.getBlockTimestamp() + 7 days));
        assertEq(vault.agentBudget(), 0);
        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AboveAgentBudget.selector, 1e6, 0));
        vault.pay(utility, 1e6, "x");
    }

    /// All thirteen onlyOwner functions listed in SECURITY.md (tier 3), from the agent key and from the guardian.
    function test_admin_is_owner_only() public {
        address[2] memory callers = [agent, guardian];
        uint256 epoch = vault.epoch();
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setPayee(attacker, 1e12);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setLimits(LeashVault.Limits(type(uint128).max, type(uint128).max, 0, 0));
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setRisk(LeashVault.Risk(10_000, 10_000, type(uint32).max));
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setPool(ILeashPool(attacker));
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setAgent(attacker, type(uint64).max);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setAgentBudget(BUDGET, type(uint128).max);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.revokeAgent();
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.bumpEpoch();
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setGuardian(attacker);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.unpause();
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.withdraw(usd, attacker, 1);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setSealAllowance(attacker, 0, type(uint128).max);
            vm.expectRevert(LeashVault.NotOwner.selector);
            vault.setContestWindow(0);
            vm.stopPrank();
        }
        assertEq(vault.sealAllowance(attacker), 0);
        assertEq(vault.contestWindow(), 1 days);
        assertEq(vault.agent(), agent);
        assertEq(vault.guardian(), guardian);
        assertEq(address(vault.pool()), address(pool));
        assertEq(vault.payeeCap(attacker), 0);
        assertEq(vault.agentBudget(), BUDGET);
        assertEq(vault.epoch(), epoch);
        assertFalse(vault.paused());
    }

    function test_owner_withdraw() public {
        vm.prank(owner);
        vault.withdraw(usd, owner, 1000e6);
        assertEq(usd.balanceOf(owner), 1000e6);
    }
}

contract SwapTest is LeashBase {
    function _floor(bool buy, uint256 amountIn) internal view returns (uint256) {
        return vault.fairOut(buy, amountIn) * 9900 / 10_000;
    }

    function test_swap_buy_at_fair_price() public {
        uint256 minOut = _floor(true, 500e6);
        vm.prank(agent);
        uint256 out = vault.swap(true, 500e6, minOut, "dca-1");
        assertGe(out, minOut);
        assertEq(eth.balanceOf(address(vault)), 1e18 + out);
        assertEq(usd.allowance(address(vault), address(pool)), 0, "allowance must not survive");
    }

    function test_swap_sell_at_fair_price() public {
        uint256 minOut = _floor(false, 0.1e18);
        vm.prank(agent);
        uint256 out = vault.swap(false, 0.1e18, minOut, "derisk-1");
        assertGe(out, minOut);
        assertEq(eth.allowance(address(vault), address(pool)), 0);
    }

    function test_swap_rejects_agent_min_out_below_oracle_floor() public {
        uint256 floor = _floor(true, 500e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.SlippageAboveMandate.selector, 0, floor));
        vault.swap(true, 500e6, 0, "x");
    }

    function test_swap_refuses_manipulated_pool() public {
        // A whale pumps tETH in the pool by 10%; the oracle does not move.
        vm.prank(whale);
        pool.swapExactIn(address(usd), 50_000e6, 0, whale);
        uint256 minOut = _floor(true, 500e6);
        vm.prank(agent);
        vm.expectRevert(bytes("slippage"));
        vault.swap(true, 500e6, minOut, "x");
    }

    function test_swap_rejects_stale_oracle() public {
        vm.warp(vm.getBlockTimestamp() + 3601);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.StaleOracle.selector, vm.getBlockTimestamp() - 3601));
        vault.swap(true, 100e6, 0, "x");
    }

    function test_swap_rejects_bad_oracle() public {
        feed.set(0, vm.getBlockTimestamp());
        vm.prank(agent);
        vm.expectRevert(LeashVault.BadOraclePrice.selector);
        vault.swap(true, 100e6, 0, "x");
    }

    function test_swap_rejects_exposure_above_mandate() public {
        vm.prank(owner);
        vault.setRisk(LeashVault.Risk({maxSlippageBps: 100, maxRiskBps: 2100, maxOracleAge: 3600}));
        uint256 minOut = _floor(true, 500e6);
        vm.prank(agent);
        vm.expectPartialRevert(LeashVault.ExposureAboveMandate.selector);
        vault.swap(true, 500e6, minOut, "x");
    }

    function test_swap_selling_is_never_blocked_by_exposure() public {
        vm.prank(owner);
        vault.setRisk(LeashVault.Risk({maxSlippageBps: 100, maxRiskBps: 0, maxOracleAge: 3600}));
        uint256 minOut = _floor(false, 0.1e18);
        vm.prank(agent);
        vault.swap(false, 0.1e18, minOut, "derisk");
    }

    function test_swap_limits() public {
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AbovePerTxLimit.selector, 501e6, 500e6));
        vault.swap(true, 501e6, 0, "x");
        vault.swap(true, 500e6, _floor(true, 500e6), "a");
        vault.swap(true, 400e6, _floor(true, 400e6), "b");
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AboveDailyLimit.selector, 1001e6, 1000e6));
        vault.swap(true, 101e6, 0, "c");
        vm.stopPrank();
    }
}

contract MandateTest is LeashBase {
    function test_mandate_pays_outside_tier1() public {
        address school = makeAddr("school"); // not a payee, above every tier-1 limit
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, school, 5000e6, "tuition", deadline);
        vm.prank(agent);
        vault.payWithMandate(school, 5000e6, "tuition", deadline, sig);
        assertEq(usd.balanceOf(school), 5000e6);
        assertEq(vault.agentBudget(), BUDGET, "the owner signed this one: it is not the agent's money");
    }

    function test_mandate_rejects_foreign_signer() public {
        (, uint256 pk) = makeAddrAndKey("not-owner");
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(pk, attacker, 5000e6, "op", deadline);
        vm.prank(agent);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        vault.payWithMandate(attacker, 5000e6, "op", deadline, sig);
    }

    function test_mandate_rejects_tampered_amount_or_payee() public {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline);
        vm.startPrank(agent);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        vault.payWithMandate(landlord, 2001e6, "op", deadline, sig);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        vault.payWithMandate(attacker, 2000e6, "op", deadline, sig);
        vm.stopPrank();
    }

    function test_mandate_rejects_replay() public {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline);
        vm.startPrank(agent);
        vault.payWithMandate(landlord, 2000e6, "op", deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.OpAlreadyUsed.selector, bytes32("op")));
        vault.payWithMandate(landlord, 2000e6, "op", deadline, sig);
        vm.stopPrank();
    }

    function test_mandate_rejects_after_deadline() public {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline);
        vm.warp(deadline + 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.MandateExpired.selector, deadline));
        vault.payWithMandate(landlord, 2000e6, "op", deadline, sig);
    }

    function test_mandate_voided_by_epoch_bump() public {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline);
        vm.prank(owner);
        vault.bumpEpoch();
        vm.prank(agent);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        vault.payWithMandate(landlord, 2000e6, "op", deadline, sig);
    }

    function test_mandate_not_inherited_by_new_agent() public {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline);
        address agent2 = makeAddr("agent2");
        vm.prank(owner);
        vault.setAgent(agent2, uint64(vm.getBlockTimestamp() + 1 days));
        vm.prank(agent2);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        vault.payWithMandate(landlord, 2000e6, "op", deadline, sig);
    }

    function test_mandate_only_runs_through_agent() public {
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline);
        vm.prank(attacker);
        vm.expectRevert(LeashVault.NotAgent.selector);
        vault.payWithMandate(landlord, 2000e6, "op", deadline, sig);
    }

    function test_mandate_cannot_cross_vaults() public {
        LeashVault other = new LeashVault(owner, usd, eth, IAggregatorV3(address(feed)));
        usd.mint(address(other), 10_000e6);
        vm.prank(owner);
        other.setAgent(agent, uint64(vm.getBlockTimestamp() + 1 days));
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 2000e6, "op", deadline); // signed for `vault`
        vm.prank(agent);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        other.payWithMandate(landlord, 2000e6, "op", deadline, sig);
    }
}

/// The scenario that matters: the attacker holds the agent's private key.
contract StolenKeyFuzz is LeashBase {
    function testFuzz_stolen_agent_key_cannot_reach_attacker(address to, uint256 amount, bytes32 opId) public {
        vm.assume(to != landlord && to != utility);
        amount = bound(amount, 1, 10_000e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.PayeeNotAllowed.selector, to));
        vault.pay(to, amount, opId);
    }

    function testFuzz_trusted_payees_bounded_per_day(uint256[8] memory amounts, uint8 warps) public {
        uint256 total;
        for (uint256 i; i < amounts.length; i++) {
            uint256 a = bound(amounts[i], 1, 900e6);
            vm.prank(agent);
            try vault.pay(landlord, a, keccak256(abi.encode(i, warps))) {
                total += a;
            } catch {}
        }
        assertLe(total, 1500e6, "daily cap breached");
        assertEq(usd.balanceOf(landlord), total);
    }

    /// Over any number of days, the stolen key moves at most its budget, whatever the daily cap allows.
    function testFuzz_stolen_key_total_bounded_by_budget(uint256[12] memory amounts, uint256[12] memory gaps) public {
        uint256 total;
        for (uint256 i; i < amounts.length; i++) {
            vm.warp(vm.getBlockTimestamp() + bound(gaps[i], 0, 3 days));
            uint256 a = bound(amounts[i], 1, 1000e6);
            vm.prank(agent);
            try vault.pay(i % 2 == 0 ? landlord : utility, a, bytes32(i)) {
                total += a;
            } catch {}
        }
        assertLe(total, BUDGET, "budget breached");
        assertEq(total + vault.agentBudget(), BUDGET);
    }

    function testFuzz_mandate_needs_owner_key(uint256 pk) public {
        pk = bound(pk, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(pk != ownerPk);
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(pk, attacker, 9000e6, "steal", deadline);
        vm.prank(agent);
        vm.expectRevert(LeashVault.BadMandateSignature.selector);
        vault.payWithMandate(attacker, 9000e6, "steal", deadline, sig);
    }
}

/// Sealed invoices: the creditor's EIP-712 seal fixes who is paid and how much; the agent only picks when.
contract SealTest is LeashBase {
    bytes32 constant TUITION = "tuition-s1";

    function settle(uint256 amount, bytes32 id) internal returns (bytes32 key) {
        bytes memory s = seal(schoolPk, school, amount, id);
        vm.prank(agent);
        vault.settleInvoice(school, amount, id, s);
        return vault.invoiceKey(school, id);
    }

    function test_sealed_invoice_is_held_then_released() public {
        // 5,000 is above the per-payment limit, the daily cap and every tier-1 path: the seal is what allows it.
        bytes32 key = settle(5000e6, TUITION);
        assertEq(vault.held(), 5000e6);
        assertEq(usd.balanceOf(school), 0);
        assertEq(vault.sealAllowance(school), 1000e6);
        assertEq(vault.agentBudget(), BUDGET, "a sealed invoice does not draw the agent's budget");
        (, uint256 paid,) = vault.today();
        assertEq(paid, 0);

        uint64 releaseAt = uint64(vm.getBlockTimestamp() + 1 days);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.StillContestable.selector, releaseAt));
        vault.release(key);
        vm.warp(releaseAt);
        vm.prank(attacker); // anyone may release; the money can only go to the sealed creditor
        vault.release(key);
        assertEq(usd.balanceOf(school), 5000e6);
        assertEq(usd.balanceOf(attacker), 0);
        assertEq(vault.held(), 0);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.NotHeld.selector, key));
        vault.release(key);
    }

    function test_altered_amount_breaks_the_seal() public {
        bytes memory s = seal(schoolPk, school, 5000e6, TUITION);
        vm.prank(agent);
        vm.expectRevert(LeashVault.BrokenSeal.selector);
        vault.settleInvoice(school, 5900e6, TUITION, s);
    }

    function test_seal_must_come_from_the_creditor() public {
        (, uint256 pk) = makeAddrAndKey("not-school");
        bytes memory forged = seal(pk, school, 1000e6, TUITION);
        vm.prank(agent);
        vm.expectRevert(LeashVault.BrokenSeal.selector);
        vault.settleInvoice(school, 1000e6, TUITION, forged);
        // The attacker seals its own invoice perfectly: the owner never accepted its seal.
        (address thief, uint256 thiefPk) = makeAddrAndKey("thief");
        bytes memory own = seal(thiefPk, thief, 1000e6, TUITION);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AboveSealAllowance.selector, 1000e6, 0));
        vault.settleInvoice(thief, 1000e6, TUITION, own);
    }

    function test_real_seal_cannot_exceed_the_allowance() public {
        bytes memory s = seal(schoolPk, school, 50_000e6, "inflated");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.AboveSealAllowance.selector, 50_000e6, SEAL_ALLOWANCE));
        vault.settleInvoice(school, 50_000e6, "inflated", s);
    }

    function test_an_invoice_settles_once() public {
        bytes32 key = settle(300e6, "fee");
        bytes memory s = seal(schoolPk, school, 300e6, "fee");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.OpAlreadyUsed.selector, key));
        vault.settleInvoice(school, 300e6, "fee", s);
    }

    function test_only_the_agent_settles() public {
        bytes memory s = seal(schoolPk, school, 300e6, "fee");
        vm.prank(school);
        vm.expectRevert(LeashVault.NotAgent.selector);
        vault.settleInvoice(school, 300e6, "fee", s);
    }

    function test_contest_keeps_the_money_and_restores_the_allowance() public {
        bytes32 key = settle(300e6, "fee");
        vm.prank(attacker);
        vm.expectRevert(LeashVault.NotGuardian.selector);
        vault.contest(key);
        vm.prank(agent);
        vm.expectRevert(LeashVault.NotGuardian.selector);
        vault.contest(key);
        vm.prank(guardian);
        vault.contest(key);
        assertEq(vault.held(), 0);
        assertEq(vault.sealAllowance(school), SEAL_ALLOWANCE);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.NotHeld.selector, key));
        vault.release(key);
        assertEq(usd.balanceOf(school), 0);
    }

    function test_contest_closes_with_the_window() public {
        bytes32 key = settle(300e6, "fee");
        uint64 releaseAt = uint64(vm.getBlockTimestamp() + 1 days);
        vm.warp(releaseAt);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.ContestWindowOver.selector, releaseAt));
        vault.contest(key);
    }

    function test_held_money_is_out_of_reach() public {
        settle(6000e6, TUITION); // the vault holds 10,000: 4,000 stay free
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.HeldForCreditors.selector, 4001e6, 4000e6));
        vault.withdraw(usd, owner, 4001e6);
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = sign(ownerPk, landlord, 4500e6, "big", deadline);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.HeldForCreditors.selector, 4500e6, 4000e6));
        vault.payWithMandate(landlord, 4500e6, "big", deadline, sig);
        vm.prank(owner);
        vault.withdraw(usd, owner, 4000e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.HeldForCreditors.selector, 800e6, 0));
        vault.pay(landlord, 800e6, "rent");
    }

    function test_release_ignores_a_pause() public {
        bytes32 key = settle(300e6, "fee");
        vm.prank(guardian);
        vault.pause();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vault.release(key);
        assertEq(usd.balanceOf(school), 300e6);
    }

    function test_allowance_reload_is_compare_and_set() public {
        settle(300e6, "fee");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.BudgetChanged.selector, SEAL_ALLOWANCE, SEAL_ALLOWANCE - 300e6));
        vault.setSealAllowance(school, SEAL_ALLOWANCE, 10_000e6);
    }

    /// Any change to the sealed amount or invoice number breaks the seal.
    function testFuzz_seal_binds_amount_and_number(uint256 sealedAmount, uint256 claimed, bytes32 id, bytes32 claimedId) public {
        sealedAmount = bound(sealedAmount, 1, SEAL_ALLOWANCE);
        claimed = bound(claimed, 1, SEAL_ALLOWANCE);
        vm.assume(claimed != sealedAmount || claimedId != id);
        bytes memory s = seal(schoolPk, school, sealedAmount, id);
        vm.prank(agent);
        vm.expectRevert(LeashVault.BrokenSeal.selector);
        vault.settleInvoice(school, claimed, claimedId, s);
    }
}